export interface WriteParams {
  key: string;
  content: string | Buffer;
  contentType?: string;
  cacheControl?: string;
}
