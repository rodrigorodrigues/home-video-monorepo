# Nextcloud Sync Feature

## Overview

The Nextcloud Sync feature automatically monitors a Nextcloud data directory and copies video files to the home-video application's user directories. This allows users to upload videos through Nextcloud, and have them automatically appear in the home-video application.

## How It Works

1. **File Monitoring**: Watches the Nextcloud data directory for file changes
2. **User Detection**: Extracts username from the Nextcloud file path
3. **Video Detection**: Checks if the file is a video (based on extension)
4. **Auto-Copy**: Copies new video files to the user's Movies folder in home-video
5. **Auto-Delete**: Removes videos from home-video when deleted from Nextcloud

### Directory Structure

**Nextcloud structure:**
```
/var/snap/nextcloud/common/nextcloud/data/
├── user1@example.com/
│   └── files/
│       └── video.mp4
└── user2@example.com/
    └── files/
        └── movie.mkv
```

**Home-video structure (after sync):**
```
${VIDEO_PATH_LOCAL}/         # Configured via VIDEO_PATH_LOCAL or VIDEO_PATH
├── user1@example.com/
│   └── Movies/
│       └── video.mp4
└── user2@example.com/
    └── Movies/
        └── movie.mkv
```

**Note**: The home-video base path is determined by the `VIDEO_PATH_LOCAL` environment variable (or `VIDEO_PATH` as fallback).

## Configuration

### Environment Variables

Add these to your `.env` file or docker-compose configuration:

```bash
# Base video directory (used by Nextcloud sync)
VIDEO_PATH_LOCAL=/data/home-video

# Enable file watcher (required)
FILE_WATCHER_ENABLED=true

# Enable Nextcloud sync
NEXTCLOUD_SYNC_ENABLED=true

# Path to Nextcloud data directory
NEXTCLOUD_DATA_PATH=/var/snap/nextcloud/common/nextcloud/data

# Sync existing files on startup (optional)
NEXTCLOUD_SYNC_EXISTING=false
```

### Docker Compose Example

```yaml
services:
  app:
    environment:
      - FILE_WATCHER_ENABLED=true
      - NEXTCLOUD_SYNC_ENABLED=true
      - NEXTCLOUD_DATA_PATH=/var/snap/nextcloud/common/nextcloud/data
      - NEXTCLOUD_SYNC_EXISTING=false
    volumes:
      - /var/snap/nextcloud/common/nextcloud/data:/var/snap/nextcloud/common/nextcloud/data:ro
      - /data/home-video:/mnt-host
```

**Note**: Mount the Nextcloud data directory as read-only (`:ro`) in Docker for safety.

## Supported Video Formats

The sync service recognizes these video formats:
- `.mp4`
- `.m4v`
- `.mkv`
- `.avi`
- `.mov`

## Features

### Automatic User Mapping

The service automatically maps Nextcloud users to home-video users based on their username/email. When a user uploads a video to Nextcloud, it's copied to their corresponding folder in home-video.

### Bidirectional Sync

The sync works in both directions:

**Adding Files:**
- When a video is uploaded to Nextcloud → It's copied to home-video
- Original file remains in Nextcloud

**Deleting Files:**
- When a video is deleted from Nextcloud → It's also deleted from home-video
- This keeps both locations in sync

**Important**: Deletion only works from Nextcloud → home-video. If you delete a file directly from home-video, it won't be deleted from Nextcloud.

### Copy vs Move

By default, the service **copies** files from Nextcloud to home-video, leaving the original in Nextcloud. To **move** files instead (delete from Nextcloud after copying), uncomment this line in `nextcloudSyncService.js`:

```javascript
// fs.unlinkSync(sourceFilePath);
```

**Note**: If you enable move mode, the auto-delete feature becomes redundant since files are already removed from Nextcloud after copying.

### Sync Existing Files

Set `NEXTCLOUD_SYNC_EXISTING=true` to scan and sync all existing video files when the application starts. This is useful for initial setup but may take time if you have many files.

### Real-time Sync

The service uses Node.js `fs.watch` to monitor file system changes in real-time. When a new video is uploaded to Nextcloud, it's immediately detected and copied to home-video.

## Raspberry Pi Setup

### Option 1: Docker with Volume Mounts

```yaml
services:
  app:
    volumes:
      - /var/snap/nextcloud/common/nextcloud/data:/nextcloud-data:ro
      - /data/home-video:/mnt-host
    environment:
      - NEXTCLOUD_DATA_PATH=/nextcloud-data
```

### Option 2: Direct Access (Snap Installation)

If running home-video directly on the Raspberry Pi with Nextcloud installed via snap:

```bash
# Grant access to Nextcloud directory
sudo chmod -R o+rX /var/snap/nextcloud/common/nextcloud/data

# Or run home-video as root (not recommended)
sudo npm start
```

## Troubleshooting

### Files Not Syncing

1. **Check permissions**: Ensure the application has read access to Nextcloud data directory
   ```bash
   ls -la /var/snap/nextcloud/common/nextcloud/data
   ```

2. **Check logs**: Look for `[NEXTCLOUD_SYNC]` messages in application logs
   ```bash
   # Docker
   docker logs home-video-app | grep NEXTCLOUD_SYNC

   # Direct
   npm start | grep NEXTCLOUD_SYNC
   ```

3. **Verify configuration**: Ensure environment variables are set correctly
   ```bash
   echo $NEXTCLOUD_SYNC_ENABLED
   echo $NEXTCLOUD_DATA_PATH
   ```

### Permission Denied Errors

If you see permission errors:

```bash
# Option 1: Add read permissions for others
sudo chmod -R o+rX /var/snap/nextcloud/common/nextcloud/data

# Option 2: Run home-video as the same user as Nextcloud
sudo -u root npm start

# Option 3: Use ACLs
sudo setfacl -R -m u:your-user:rX /var/snap/nextcloud/common/nextcloud/data
```

### Directory Not Found

If Nextcloud data directory doesn't exist at the configured path:

1. Check your Nextcloud installation:
   ```bash
   sudo snap get nextcloud datadir
   ```

2. Update the environment variable to match:
   ```bash
   NEXTCLOUD_DATA_PATH=/actual/path/to/data
   ```

### Videos Not Recognized

The service only syncs files with supported video extensions. Check if your file extension is in the `VIDEO_FORMATS` list in `apps/api/src/common/AppServerConstant.js`.

## Integration with WebSocket

When `FILE_WATCHER_ENABLED=true`, synced videos automatically trigger WebSocket notifications to connected clients, causing the video list to refresh in real-time without manual page reload.

## Performance Considerations

- **Large Files**: Copying large video files may take time. The copy operation is synchronous.
- **Many Users**: With many Nextcloud users, each user directory is watched separately.
- **Disk Space**: Files are copied (not moved by default), so ensure sufficient disk space.

## Security Notes

1. **Read-Only Mount**: Always mount Nextcloud data as read-only in Docker
2. **User Isolation**: In multi-user mode, users can only see their own videos
3. **File Validation**: Only video files are synced; other file types are ignored
4. **Path Validation**: Username extraction validates path structure to prevent directory traversal

## Example Use Cases

### 1. Family Video Library
- Family members upload videos via Nextcloud mobile app
- Videos automatically appear in home-video app for streaming
- Original files remain in Nextcloud for backup

### 2. Media Server Integration
- Use Nextcloud as upload interface
- Home-video as viewing/streaming interface
- Automatic organization by user

### 3. Remote Video Collection
- Upload videos from anywhere via Nextcloud
- Automatic sync to local media server
- Watch videos through home-video web interface
