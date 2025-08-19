import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface MCPFileToolConfig {
  toolNames: {
    uploadFile: string
    listFiles: string
    deleteFile: string
  }
  paramKeys: {
    filename: string
    contentBase64: string
  }
}

interface MCPFileState {
  toolConfig: MCPFileToolConfig
}

const initialState: MCPFileState = {
  toolConfig: {
    toolNames: {
      uploadFile: 'upload_file',
      listFiles: 'list_files',
      deleteFile: 'delete_file'
    },
    paramKeys: {
      filename: 'filename',
      contentBase64: 'content_base64'
    }
  }
}

const mcpFileSlice = createSlice({
  name: 'mcpFile',
  initialState,
  reducers: {
    setMCPFileToolConfig: (state, action: PayloadAction<MCPFileToolConfig>) => {
      state.toolConfig = action.payload
    }
  }
})

export const { setMCPFileToolConfig } = mcpFileSlice.actions
export default mcpFileSlice.reducer
