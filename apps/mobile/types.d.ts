/// <reference types="uniwind/types" />

declare module "*.css";

declare module "*.ttf" {
  const asset: number;
  export default asset;
}
