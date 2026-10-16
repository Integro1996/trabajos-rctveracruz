import { config } from "./config.js";

const provider = config.storage.driver === "s3"
  ? await import("./storage-s3.js")
  : await import("./storage-filesystem.js");

export const initializeStorage = provider.initializeStorage;
export const putDocx = provider.putDocx;
export const getDocx = provider.getDocx;
export const putAsset = provider.putAsset;
export const getAsset = provider.getAsset;
export const removeObject = provider.removeObject;
export const removeArticleObjects = provider.removeArticleObjects;
export const storageHealthy = provider.storageHealthy;
