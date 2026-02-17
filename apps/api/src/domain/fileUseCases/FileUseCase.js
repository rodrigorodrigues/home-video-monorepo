import {
  verifyingOrphanFiles,
  getFilesFolder,
  filterValidFiles,
  getFolderName,
  isThereVideoFile,
} from "./FileHelperUseCase";
import { mapMedia } from "./MediaMapper";
import { logD, logE } from "../../common/MessageUtil";
import { DEFAULT_ENCODING } from "../../common/AppServerConstant";

export default function FileUseCase({ FileApi }) {
  const { readDirectory, isDirExist, fileExtEqual, readFile, readFileInfo } =
    FileApi;
  const createEmptyTable = () => ({ byId: {}, allIds: [] });
  const loadFiles = (folderName, baseLocation) =>
    getFilesFolder(`${baseLocation}/${folderName}`, readDirectory);
  const getValidFileList = (folderName, baseLocation) => {
    // video, subtitles, img
    return filterValidFiles(loadFiles(folderName, baseLocation), fileExtEqual);
  };

  const deriveMediaId = (videoName) => {
    const fileExt = fileExtEqual(videoName);
    return videoName.slice(0, videoName.length - fileExt.length);
  };

  const listFolderMedia = (baseLocation) => {
    const allFolders = getFolderName(baseLocation, { readDirectory });
    const validFilesByFolder = allFolders.reduce((acc, folderName) => {
      acc[folderName] = getValidFileList(folderName, baseLocation);
      return acc;
    }, {});
    const hasValidFiles = (folderName) => validFilesByFolder[folderName].length > 0;
    const hasVideoInFolder = (folderName) =>
      validFilesByFolder[folderName].some((fileName) =>
        isThereVideoFile(fileName, fileExtEqual)
      );
    const buildFolderTable = (prev, folderName) => {
      const files = loadFiles(folderName, baseLocation);
      const media = mapMedia({ files, folderName, fileExtEqual });
      prev.byId[folderName] = media;
      prev.allIds.push(media.id);
      return prev;
    };

    return allFolders
      .filter(hasValidFiles)
      .filter(hasVideoInFolder)
      .reduce(buildFolderTable, createEmptyTable());
  };

  const listFlatMedia = ({ baseLocation, existingTable }) => {
    const topLevelFiles = readDirectory(baseLocation)
      .filter((item) => !item.isDirectory())
      .map((item) => item.name);
    const validTopLevelFiles = filterValidFiles(topLevelFiles, fileExtEqual);
    const topLevelVideoFiles = validTopLevelFiles.filter((fileName) =>
      isThereVideoFile(fileName, fileExtEqual)
    );

    topLevelVideoFiles.forEach((videoName) => {
      const id = deriveMediaId(videoName);
      if (existingTable.byId[id]) {
        throw new Error(
          `Media id collision for '${id}': both folder-based and flat files exist under ${baseLocation}.`
        );
      }
      const siblingFiles = validTopLevelFiles.filter((fileName) =>
        fileName.startsWith(`${id}.`)
      );
      const media = mapMedia({
        files: siblingFiles,
        folderName: id,
        fileExtEqual,
      });
      media.isFlat = true;
      existingTable.byId[id] = media;
      existingTable.allIds.push(id);
    });

    return existingTable;
  };

  return {
    getFileDirInfo: function (fullPath) {
      try {
        return FileApi.readFileInfo(fullPath);
      } catch (error) {
        logE(`Unable to read file information ${fullPath}: `);
        throw error;
      }
    },
    readFile({ absolutePath, encoding = DEFAULT_ENCODING, logError = true }) {
      try {
        return readFile(absolutePath, encoding);
      } catch (err) {
        logD(`Unable to read file ${absolutePath}: `, logError ? err : "");
      }
    },
    getSeries: function ({ baseLocation }) {
      logD(`getSeries under === ${baseLocation} ===`);
      const allFolders = getFolderName(baseLocation, {
        readDirectory,
      });
      return allFolders.reduce(
        (prev, folderName) => {
          const files = getValidFileList(folderName, baseLocation);
          const media = mapMedia({
            files,
            folderName,
            fileExtEqual,
            isFolder: true,
          });
          media.fileIds = loadFiles(folderName, baseLocation).filter((file) =>
            readFileInfo(
              baseLocation + "/" + folderName + "/" + file
            ).isDirectory()
          );
          prev.byId[folderName] = media;
          prev.allIds.push(folderName);
          return prev;
        },
        { byId: {}, allIds: [] }
      );
    },
    getVideo: function ({ baseLocation, folderName }) {
      const [parentFolder, childFolder] = String(folderName || "").split("__");
      if (!parentFolder || !childFolder) {
        throw new Error(
          "Invalid series folderName format. Expected '<parent>__<child>'."
        );
      }
      const files = loadFiles(`${parentFolder}/${childFolder}`, baseLocation);
      const media = mapMedia({ files, folderName: childFolder, fileExtEqual });
      media.parentId = parentFolder;
      return media;
    },
    //TODO need test for this one
    getVideos: function ({ baseLocation }) {
      //It just goes 1 level in the folder
      if (!isDirExist(baseLocation)) {
        return createEmptyTable();
      }
      logD(`getVideos under *** ${baseLocation} ***`);
      verifyingOrphanFiles(baseLocation, { readDirectory, fileExtEqual });

      const foldersTable = listFolderMedia(baseLocation);
      return listFlatMedia({ baseLocation, existingTable: foldersTable });
    },
    getFileExt(fileName) {
      return fileExtEqual(fileName);
    },
  };
}
