import * as core from '@actions/core'
import { glob } from 'glob'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { MemoryStorage, TelegramClient } from '@mtcute/node'
import { NodeCryptoProvider } from '@mtcute/node/utils.js'
import { IGE } from '@cryptography/aes'

function wordsToBytes(words: Uint32Array): Uint8Array {
  const o = new Uint8Array(words.byteLength)

  const len = words.length * 4

  for (let i = 0; i < len; ++i) {
    o[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
  }

  return o
}

class ActionsCryptoProvider extends NodeCryptoProvider {
  async initialize() {
    // do nothing
  }
  createAesIge(key: Uint8Array, iv: Uint8Array) {
    return {
      encrypt(data: Uint8Array): Uint8Array {
        const ige = new IGE(key, iv)
        return wordsToBytes(ige.encrypt(data))
      },
      decrypt(data: Uint8Array): Uint8Array {
        const ige = new IGE(key, iv)
        return wordsToBytes(ige.decrypt(data))
      }
    }
  }
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const apiId: string = core.getInput('api-id')
    const apiHash: string = core.getInput('api-hash')
    const botToken: string = core.getInput('bot-token')
    const tg = new TelegramClient({
      apiId: parseInt(apiId, 10),
      apiHash: apiHash,
      storage: new MemoryStorage(),
      crypto: new ActionsCryptoProvider()
    })

    const user = await tg.start({ botToken: botToken })

    core.debug(`Logged in as ${user.username} (${user.id})`)

    const chatId: string = core.getInput('chat-id')
    const patterns = core.getMultilineInput('files')

    // Resolve glob patterns into actual file paths
    const filePaths = (
      await Promise.all(
        patterns.map((pattern) => glob(pattern, { nodir: true }))
      )
    ).flat()

    if (filePaths.length === 0) {
      core.warning('No files matched the provided patterns.')
      return
    }

    // Build media group
    const media = filePaths.map((filePath) => {
      const fileBuffer = fs.readFileSync(filePath)
      const fileName = path.basename(filePath)

      return {
        type: 'document' as const,
        file: fileBuffer,
        fileName
      }
    })

    await tg.sendMediaGroup(chatId, media, {
      progressCallback(index, uploaded, total) {
        core.info(
          `Uploading file ${index + 1}/${media.length}: ${uploaded}/${total} bytes uploaded.`
        )
      }
    })

    core.info(`Sent ${media.length} files.`)

    await tg.logOut()
    await tg.destroy()
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
