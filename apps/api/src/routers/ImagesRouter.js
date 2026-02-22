import express from "express";
import path from "path";
import { getMovieMap, getSeriesMap } from "../common/Util";
import { imgProvider, sendError } from "./RouterUtil";
import config from "../config";
import { getUserVideoPath } from "../user/userDirectory.js";
import { logE } from "../common/MessageUtil";

const { moviesDir, seriesDir } = config();

const router = express.Router();

router.get("/images/:id", getImgFromMovie);
router.get("/images/series/:id", getImgFromSeries);

// Helper to get user-specific video path
function getUserVideosPath(req) {
  const multiUserEnabled = process.env.MULTI_USER_ENABLED === "true";
  if (multiUserEnabled && req.user && req.user.username) {
    return getUserVideoPath(req.user.username);
  }
  return null; // Will use default in imgProvider
}

function getImgFromSeries(req, response) {
  const { id } = req.params;
  const userVideosPath = getUserVideosPath(req);

  const seriesMap = getSeriesMap();

  // Security: Verify the requested ID exists in the user's series map
  if (!seriesMap.byId[id]) {
    logE(`Access denied: User attempted to access non-existent series image: ${id}`);
    return sendError({
      response,
      message: "Image not found",
      statusCode: 404,
    });
  }

  const { name, img } = seriesMap.byId[id];

  let binImg = imgProvider({ id, name, img, folder: seriesDir, userVideosPath });

  response.write(binImg, "binary");
  response.end(null, "binary");
}

function getImgFromMovie(req, response) {
  const { id } = req.params;
  const userVideosPath = getUserVideosPath(req);

  const MovieMap = getMovieMap();

  // Security: Verify the requested ID exists in the user's movie map
  if (!MovieMap.byId[id]) {
    logE(`Access denied: User attempted to access non-existent movie image: ${id}`);
    return sendError({
      response,
      message: "Image not found",
      statusCode: 404,
    });
  }

  const { name, img } = MovieMap.byId[id];

  let binImg = imgProvider({ id, name, img, folder: moviesDir, userVideosPath });

  response.write(binImg, "binary");
  response.end(null, "binary");
}

export default router;
