# Multi-User Security and Isolation

## Overview

When `MULTI_USER_ENABLED=true`, the home-video application enforces strict user isolation to ensure users can only access their own video content. This document outlines the security measures in place.

## User Isolation Architecture

### Directory Structure

Each user has isolated directories:

```
/data/home-video/
├── user1@example.com/
│   ├── Movies/
│   └── Series/
└── user2@example.com/
    ├── Movies/
    └── Series/
```

### Authentication Layer

1. **Session-based authentication** - Users must be authenticated to access any video content
2. **User context** - `req.user.username` is attached to all authenticated requests
3. **JWT or Spring Session** - Supports multiple authentication methods

## Security Controls

### 1. Path-Based Access Control

All video, image, and caption endpoints validate that requested files are within the user's directory:

```javascript
// VideosRouter.js - streamingVideo()
const resolvedPath = path.resolve(fileAbsPath);
const resolvedMoviesPath = path.resolve(moviesPath);

if (!resolvedPath.startsWith(resolvedMoviesPath)) {
  return sendError({
    response,
    message: "Access denied",
    statusCode: 403,
  });
}
```

This prevents **path traversal attacks** like:
- `/videos/../../../etc/passwd`
- `/videos/../../other-user@example.com/Movies/video.mp4`

### 2. User-Specific Video Listing

Video listing endpoints use `getUserPaths(req)` to ensure users only see their own videos:

```javascript
// VideosRouter.js - loadMovies()
const { moviesPath } = getUserPaths(req);
const videos = getVideos({ baseLocation: moviesPath });
```

**Result**: User A cannot see User B's video list.

### 3. Map-Based Validation

Images and video metadata use in-memory maps that are scoped to the authenticated user:

```javascript
// ImagesRouter.js - getImgFromMovie()
if (!MovieMap.byId[id]) {
  return sendError({
    response,
    message: "Image not found",
    statusCode: 404,
  });
}
```

**Result**: User A cannot request User B's images by guessing IDs.

### 4. WebSocket User Filtering

Real-time updates are filtered by username:

```javascript
// WebSocket client - VideoMainList.jsx
if (data.username && data.username !== currentUser) {
  return; // Ignore events for other users
}
```

**Result**: User A doesn't receive notifications about User B's video uploads.

## Protected Endpoints

### Videos

- ✅ `GET /videos` - Lists only user's videos
- ✅ `GET /videos/:id` - Validates ID belongs to user
- ✅ `GET /videos/:folder/:fileName` - Path traversal protection
- ✅ `GET /series/:parent/:folder/:fileName` - Path traversal protection

### Images

- ✅ `GET /images/:id` - Validates ID exists in user's map
- ✅ `GET /images/series/:id` - Validates ID exists in user's map

### Captions

- ✅ `GET /captions/:folder/:fileName` - Path traversal protection
- ✅ `GET /captions/:parent/:folder/:fileName` - Path traversal protection

## Attack Scenarios and Mitigations

### Scenario 1: Path Traversal via URL Parameters

**Attack**: `GET /videos/../other-user@example.com/Movies/secret.mp4`

**Mitigation**:
```javascript
const resolvedPath = path.resolve(fileAbsPath);
const resolvedMoviesPath = path.resolve(moviesPath);

if (!resolvedPath.startsWith(resolvedMoviesPath)) {
  return 403 Access Denied
}
```

### Scenario 2: Direct File Access by ID

**Attack**: User A tries to access User B's video by guessing the folder ID

**Mitigation**: Video lists are generated from user-specific directories only. User A's map doesn't contain User B's video IDs.

### Scenario 3: Symlink Attack

**Attack**: User A creates a symlink in their directory pointing to User B's directory

**Mitigation**: `path.resolve()` resolves symlinks to real paths, then validates the real path is within the user's directory.

### Scenario 4: WebSocket Message Spoofing

**Attack**: User A sends a fake WebSocket message claiming to be User B

**Mitigation**: WebSocket messages are server-originated only. The server determines username from the file system path, not from client input.

## Testing User Isolation

### Test Case 1: Video List Isolation

```bash
# Login as user1@example.com
curl -H "Cookie: session=..." http://localhost:8080/videos

# Should only return videos in /data/home-video/user1@example.com/Movies/
# Should NOT return videos from other users
```

### Test Case 2: Path Traversal Attempt

```bash
# Try to access another user's video
curl -H "Cookie: session=..." \
  http://localhost:8080/videos/../user2@example.com/Movies/video.mp4

# Should return 403 Access Denied
```

### Test Case 3: Image Access

```bash
# Get user1's video list to get valid IDs
curl -H "Cookie: session=..." http://localhost:8080/videos

# Try to access an image with a valid ID
curl -H "Cookie: session=..." http://localhost:8080/images/valid-id
# Should succeed

# Try to access an image that doesn't exist in user's map
curl -H "Cookie: session=..." http://localhost:8080/images/other-user-id
# Should return 404 Image not found
```

## Security Checklist

When adding new endpoints that access user files:

- [ ] Use `getUserPaths(req)` to get user-specific directories
- [ ] Validate resolved file paths with `path.resolve()` and `.startsWith()`
- [ ] Check that requested IDs exist in user's map (if using maps)
- [ ] Log access denied attempts for security monitoring
- [ ] Return generic error messages (don't leak path information)
- [ ] Test with path traversal attempts (`../`, `..\\`, encoded characters)

## Logging and Monitoring

All access denied attempts are logged:

```javascript
logE(`Access denied: User attempted to access file outside their directory: ${resolvedPath}`);
```

Monitor logs for patterns like:
- Multiple 403 responses from same user
- Attempts to access `../` in paths
- Rapid sequential ID guessing attempts

## Configuration

User isolation is controlled by environment variable:

```bash
MULTI_USER_ENABLED=true  # Enable user isolation
MULTI_USER_ENABLED=false # All users share same directory (default)
```

**Security Note**: When `MULTI_USER_ENABLED=false`, all authenticated users can access all videos. This mode is intended for single-user or trusted multi-user environments only.

## File System Permissions

Even with application-level security, ensure proper file system permissions:

```bash
# User directories should be readable only by the application user
chmod 750 /data/home-video/*/
chown -R app-user:app-group /data/home-video/

# Individual files should not be world-readable
chmod 640 /data/home-video/*/*/*
```

## Related Documentation

- [Multi-User Support](../features/multi-user.md)
- [Authentication Architecture](../auth/authentication.md)
- [Nextcloud Sync Security](../features/nextcloud-sync.md#security-notes)
