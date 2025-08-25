// import Logger from 'electron-log'
// import type { Operator as OperatorType } from 'opendal'
// const { Operator } = require('opendal')

// export default class S3Storage {
//   public instance: OperatorType | undefined

//   /**
//    *
//    * @param scheme is the scheme for opendal services. Available value includes "azblob", "azdls", "cos", "gcs", "obs", "oss", "s3", "webdav", "webhdfs", "aliyun-drive", "alluxio", "azfile", "dropbox", "gdrive", "onedrive", "postgresql", "mysql", "redis", "swift", "mongodb", "alluxio", "b2", "seafile", "upyun", "koofr", "yandex-disk"
//    * @param options is the options for given opendal services. Valid options depend on the scheme. Checkout https://docs.rs/opendal/latest/opendal/services/index.html for all valid options.
//    *
//    * For example, use minio as remote storage:
//    *
//    * ```typescript
//    * const storage = new S3Storage('s3', {
//    *   endpoint: 'http://localhost:9000',
//    *   region: 'us-east-1',
//    *   bucket: 'testbucket',
//    *   access_key_id: 'user',
//    *   secret_access_key: 'password',
//    *   root: '/path/to/basepath',
//    * })
//    * ```
//    */
//   constructor(scheme: string, options?: Record<string, string> | undefined | null) {
//     this.instance = new Operator(scheme, options)

//     this.putFileContents = this.putFileContents.bind(this)
//     this.getFileContents = this.getFileContents.bind(this)
//   }

//   public putFileContents = async (filename: string, data: string | Buffer) => {
//     if (!this.instance) {
//       return new Error('RemoteStorage client not initialized')
//     }

//     try {
//       return await this.instance.write(filename, data)
//     } catch (error) {
//       Logger.error('[RemoteStorage] Error putting file contents:', error)
//       throw error
//     }
//   }

//   public getFileContents = async (filename: string) => {
//     if (!this.instance) {
//       throw new Error('RemoteStorage client not initialized')
//     }

//     try {
//       return await this.instance.read(filename)
//     } catch (error) {
//       Logger.error('[RemoteStorage] Error getting file contents:', error)
//       throw error
//     }
//   }

//   public deleteFile = async (filename: string) => {
//     if (!this.instance) {
//       throw new Error('RemoteStorage client not initialized')
//     }
//     try {
//       return await this.instance.delete(filename)
//     } catch (error) {
//       Logger.error('[RemoteStorage] Error deleting file:', error)
//       throw error
//     }
//   }

//   public checkConnection = async () => {
//     if (!this.instance) {
//       throw new Error('RemoteStorage client not initialized')
//     }
//     try {
//       // 检查根目录是否可访问
//       return await this.instance.stat('/')
//     } catch (error) {
//       Logger.error('[RemoteStorage] Error checking connection:', error)
//       throw error
//     }
//   }
// }
