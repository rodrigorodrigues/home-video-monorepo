import fs from "fs";
import path from "path";
import { logD } from "../common/MessageUtil.js";
import { VIDEO_FORMATS } from "../common/AppServerConstant.js";

/**
 * Service to sync video files from Nextcloud to home-video directory structure
 * Watches Nextcloud data directory and moves video files to user's Movies folder
 */
export function createNextcloudSyncService({
  nextcloudDataPath,
  homeVideoBasePath,
  moviesDir = "Movies"
}) {
  const watchers = new Map();
  const nextcloudEnabled = process.env.NEXTCLOUD_SYNC_ENABLED === "true";
  const fileWatcherEnabled = process.env.FILE_WATCHER_ENABLED === "true";

  logD(`[NEXTCLOUD_SYNC] Service initialized. Enabled: ${nextcloudEnabled && fileWatcherEnabled}`);
  logD(`[NEXTCLOUD_SYNC] Nextcloud path: ${nextcloudDataPath}`);
  logD(`[NEXTCLOUD_SYNC] Home video path: ${homeVideoBasePath}`);

  /**
   * Check if a file is a video based on extension
   */
  function isVideoFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return VIDEO_FORMATS.includes(ext);
  }

  /**
   * Extract username from Nextcloud file path
   * Expected format: /var/snap/nextcloud/common/nextcloud/data/{username}/files/...
   */
  function extractUsernameFromPath(filePath) {
    const relativePath = path.relative(nextcloudDataPath, filePath);
    const parts = relativePath.split(path.sep);

    // First part should be the username
    if (parts.length > 0 && parts[0] && parts[0] !== '.' && parts[0] !== '..') {
      return parts[0];
    }

    return null;
  }

  /**
   * Move video file to user's Movies directory
   */
  async function moveVideoToMovies(sourceFilePath, username) {
    try {
      // Validate source file exists
      if (!fs.existsSync(sourceFilePath)) {
        logD(`[NEXTCLOUD_SYNC] Source file does not exist: ${sourceFilePath}`);
        return false;
      }

      // Get file stats to ensure it's a file
      const stats = fs.statSync(sourceFilePath);
      if (!stats.isFile()) {
        return false;
      }

      // Build destination path
      const filename = path.basename(sourceFilePath);
      const userMoviesPath = path.join(homeVideoBasePath, username, moviesDir);
      const destFilePath = path.join(userMoviesPath, filename);

      // Create user Movies directory if it doesn't exist
      if (!fs.existsSync(userMoviesPath)) {
        logD(`[NEXTCLOUD_SYNC] Creating directory: ${userMoviesPath}`);
        fs.mkdirSync(userMoviesPath, { recursive: true });
      }

      // Check if file already exists at destination
      if (fs.existsSync(destFilePath)) {
        logD(`[NEXTCLOUD_SYNC] File already exists at destination: ${destFilePath}`);
        return false;
      }

      // Copy file to destination
      logD(`[NEXTCLOUD_SYNC] Copying video: ${filename} -> ${destFilePath}`);
      fs.copyFileSync(sourceFilePath, destFilePath);

      // Verify copy succeeded
      if (fs.existsSync(destFilePath)) {
        const destStats = fs.statSync(destFilePath);
        if (destStats.size === stats.size) {
          logD(`[NEXTCLOUD_SYNC] Successfully copied ${filename} for user ${username}`);

          // Optionally delete the source file from Nextcloud
          // Uncomment if you want to move instead of copy:
          // fs.unlinkSync(sourceFilePath);
          // logD(`[NEXTCLOUD_SYNC] Deleted source file: ${sourceFilePath}`);

          return true;
        }
      }

      return false;
    } catch (error) {
      console.error(`[NEXTCLOUD_SYNC] Error moving video file:`, error);
      return false;
    }
  }

  /**
   * Delete video file from user's Movies directory
   */
  async function deleteVideoFromMovies(filename, username) {
    try {
      const userMoviesPath = path.join(homeVideoBasePath, username, moviesDir);
      const destFilePath = path.join(userMoviesPath, filename);

      // Check if file exists in destination
      if (!fs.existsSync(destFilePath)) {
        return false;
      }

      // Delete the file
      logD(`[NEXTCLOUD_SYNC] Deleting video: ${destFilePath}`);
      fs.unlinkSync(destFilePath);
      logD(`[NEXTCLOUD_SYNC] Successfully deleted ${filename} for user ${username}`);

      return true;
    } catch (error) {
      console.error(`[NEXTCLOUD_SYNC] Error deleting video file:`, error);
      return false;
    }
  }

  /**
   * Process a file event from Nextcloud directory
   */
  async function processFileEvent(eventType, filePath) {
    try {
      // Only process 'rename' events (which indicate new files, moves, or deletions)
      if (eventType !== 'rename') {
        return;
      }

      // Check if it's a video file path
      if (!isVideoFile(filePath)) {
        return;
      }

      // Extract username from path
      const username = extractUsernameFromPath(filePath);
      if (!username) {
        logD(`[NEXTCLOUD_SYNC] Could not extract username from path: ${filePath}`);
        return;
      }

      const filename = path.basename(filePath);

      // Check if file exists (rename event fires for both additions and deletions)
      if (fs.existsSync(filePath)) {
        // File was added or moved
        logD(`[NEXTCLOUD_SYNC] New video detected for user ${username}: ${filename}`);
        await moveVideoToMovies(filePath, username);
      } else {
        // File was deleted
        logD(`[NEXTCLOUD_SYNC] Video deleted in Nextcloud for user ${username}: ${filename}`);
        await deleteVideoFromMovies(filename, username);
      }
    } catch (error) {
      console.error(`[NEXTCLOUD_SYNC] Error processing file event:`, error);
    }
  }

  /**
   * Watch a user directory in Nextcloud
   */
  function watchUserDirectory(username) {
    const userPath = path.join(nextcloudDataPath, username);

    try {
      // Check if path exists
      if (!fs.existsSync(userPath)) {
        logD(`[NEXTCLOUD_SYNC] User directory does not exist: ${userPath}`);
        return null;
      }

      // Check if it's a symlink using lstat (doesn't follow symlinks)
      const stats = fs.lstatSync(userPath);
      if (stats.isSymbolicLink()) {
        logD(`[NEXTCLOUD_SYNC] Skipping symlink user directory: ${userPath}`);
        return null;
      }

      // Verify it's actually a directory
      if (!stats.isDirectory()) {
        logD(`[NEXTCLOUD_SYNC] Path is not a directory: ${userPath}`);
        return null;
      }

      logD(`[NEXTCLOUD_SYNC] Starting to watch user directory: ${userPath}`);

      const watcher = fs.watch(userPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = path.join(userPath, filename);
        processFileEvent(eventType, fullPath);
      });

      watcher.on('error', (error) => {
        console.error(`[NEXTCLOUD_SYNC] Error watching ${userPath}:`, error);
      });

      return watcher;
    } catch (error) {
      // Log but don't crash if we can't watch a particular directory
      if (error.code === 'ENOENT') {
        logD(`[NEXTCLOUD_SYNC] User directory does not exist: ${userPath}`);
      } else if (error.code === 'EACCES') {
        logD(`[NEXTCLOUD_SYNC] Permission denied for directory: ${userPath}`);
      } else {
        console.error(`[NEXTCLOUD_SYNC] Failed to watch ${userPath}:`, error);
      }
      return null;
    }
  }

  /**
   * Start watching all user directories in Nextcloud
   */
  function startWatching() {
    if (!nextcloudEnabled || !fileWatcherEnabled) {
      logD(`[NEXTCLOUD_SYNC] Sync disabled (NEXTCLOUD_SYNC_ENABLED=${nextcloudEnabled}, FILE_WATCHER_ENABLED=${fileWatcherEnabled})`);
      return;
    }

    if (!fs.existsSync(nextcloudDataPath)) {
      console.error(`[NEXTCLOUD_SYNC] Nextcloud data path does not exist: ${nextcloudDataPath}`);
      return;
    }

    try {
      // Read all directories in Nextcloud data path (these are usernames)
      const entries = fs.readdirSync(nextcloudDataPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden directories, system directories, and symlinks
        if (entry.name.startsWith('.') ||
            entry.name.startsWith('appdata_') ||
            entry.isSymbolicLink()) {
          continue;
        }

        if (entry.isDirectory()) {
          const username = entry.name;
          const watcher = watchUserDirectory(username);
          if (watcher) {
            watchers.set(username, watcher);
          }
        }
      }

      logD(`[NEXTCLOUD_SYNC] Started watching ${watchers.size} user directories`);
    } catch (error) {
      console.error(`[NEXTCLOUD_SYNC] Error starting watchers:`, error);
    }
  }

  /**
   * Stop all watchers
   */
  function stopWatching() {
    logD(`[NEXTCLOUD_SYNC] Stopping all watchers`);
    watchers.forEach((watcher, username) => {
      try {
        watcher.close();
        logD(`[NEXTCLOUD_SYNC] Closed watcher for user: ${username}`);
      } catch (err) {
        console.error(`[NEXTCLOUD_SYNC] Error closing watcher for ${username}:`, err);
      }
    });
    watchers.clear();
  }

  /**
   * Manually sync all existing video files from Nextcloud
   */
  async function syncExistingFiles() {
    if (!nextcloudEnabled || !fileWatcherEnabled) {
      logD(`[NEXTCLOUD_SYNC] Sync disabled, skipping existing files sync`);
      return;
    }

    logD(`[NEXTCLOUD_SYNC] Syncing existing video files...`);

    try {
      const entries = fs.readdirSync(nextcloudDataPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden directories, system directories, and symlinks
        if (entry.name.startsWith('.') ||
            entry.name.startsWith('appdata_') ||
            entry.isSymbolicLink()) {
          continue;
        }

        if (entry.isDirectory()) {
          const username = entry.name;
          const userPath = path.join(nextcloudDataPath, username);

          // Recursively find all video files in user directory
          await scanDirectoryForVideos(userPath, username);
        }
      }

      logD(`[NEXTCLOUD_SYNC] Finished syncing existing files`);
    } catch (error) {
      console.error(`[NEXTCLOUD_SYNC] Error syncing existing files:`, error);
    }
  }

  /**
   * Recursively scan directory for video files
   */
  async function scanDirectoryForVideos(dirPath, username) {
    try {
      // Check if directory exists and is accessible before scanning
      if (!fs.existsSync(dirPath)) {
        logD(`[NEXTCLOUD_SYNC] Directory does not exist, skipping: ${dirPath}`);
        return;
      }

      // Check if it's a symlink and resolve it
      const stats = fs.lstatSync(dirPath);
      if (stats.isSymbolicLink()) {
        logD(`[NEXTCLOUD_SYNC] Skipping symlink: ${dirPath}`);
        return;
      }

      if (!stats.isDirectory()) {
        return;
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        try {
          if (entry.isSymbolicLink()) {
            logD(`[NEXTCLOUD_SYNC] Skipping symlink: ${fullPath}`);
            continue;
          }

          if (entry.isDirectory()) {
            await scanDirectoryForVideos(fullPath, username);
          } else if (entry.isFile() && isVideoFile(entry.name)) {
            await moveVideoToMovies(fullPath, username);
          }
        } catch (entryError) {
          // Log and continue with other entries if one fails
          logD(`[NEXTCLOUD_SYNC] Error processing ${fullPath}: ${entryError.message}`);
        }
      }
    } catch (error) {
      // Only log as error if it's not ENOENT (file not found) or EACCES (permission denied)
      if (error.code === 'ENOENT') {
        logD(`[NEXTCLOUD_SYNC] Directory no longer exists, skipping: ${dirPath}`);
      } else if (error.code === 'EACCES') {
        logD(`[NEXTCLOUD_SYNC] Permission denied, skipping: ${dirPath}`);
      } else {
        console.error(`[NEXTCLOUD_SYNC] Error scanning directory ${dirPath}:`, error);
      }
    }
  }

  return {
    startWatching,
    stopWatching,
    syncExistingFiles,
    isEnabled: () => nextcloudEnabled && fileWatcherEnabled,
    isWatching: () => watchers.size > 0
  };
}
