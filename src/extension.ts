import * as vscode from 'vscode'
import * as Path from 'path'
import { MemFS } from './memFs'
const PegJs = require('pegjs')

const PEGJS_INPUT_SCHEME = 'pegjsin'

interface GrammarConfig {
   grammar_uri: vscode.Uri
   start_rule: string | null
}

export function activate(context: vscode.ExtensionContext) {
   const pegjs_output = vscode.window.createOutputChannel('PEG.js')
   const memory_fs = new MemFS()
   const grammars = new Map<string, GrammarConfig>()

   const grammarNameFromUri = (uri: vscode.Uri) => {
      return Path.basename(uri.fsPath)
         .replace(/.pegjs$/, '')
         .replace(/^\([^)]\)__/, '')
   }

   const documents_changed = vscode.workspace.onDidChangeTextDocument(async doc => {
      const grammar_name = grammarNameFromUri(doc.document.uri)
      const grammar_config = grammars.get(grammar_name)

      if (grammar_config != null) {
         executeAndDisplayResults(pegjs_output, doc.document.uri, grammar_config)
      }
   })

   context.subscriptions.push(
      documents_changed,
      pegjs_output,
      vscode.commands.registerTextEditorCommand('editor.pegjsLiveFromHere', async editor => {
         const grammar_name = grammarNameFromUri(editor.document.uri)

         const word_range = editor.document.getWordRangeAtPosition(
            editor.selection.start,
            /[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*/
         )

         if (word_range != null) {
            const rule_name = editor.document.getText(word_range)
            const input_document_uri = vscode.Uri.parse(`${PEGJS_INPUT_SCHEME}:/(${rule_name})__${grammar_name}`)

            memory_fs.writeFile(input_document_uri, Buffer.from(''), {
               create: true,
               overwrite: true,
            })

            if (!grammars.get(grammar_name)) {
               await vscode.window.showTextDocument(input_document_uri, {
                  viewColumn: vscode.ViewColumn.Beside,
               })
            }

            const grammar_config: GrammarConfig = {
               grammar_uri: editor.document.uri,
               start_rule: rule_name,
            }

            grammars.set(grammar_name, grammar_config)

            executeAndDisplayResults(pegjs_output, input_document_uri, grammar_config)
         }
      }),
      vscode.commands.registerTextEditorCommand('editor.pegjsLive', async editor => {
         const grammar_name = grammarNameFromUri(editor.document.uri)

         const input_document_uri = vscode.Uri.parse(`${PEGJS_INPUT_SCHEME}:/${grammar_name}`)

         memory_fs.writeFile(input_document_uri, Buffer.from(''), {
            create: true,
            overwrite: true,
         })

         if (!grammars.get(grammar_name)) {
            await vscode.window.showTextDocument(input_document_uri, {
               viewColumn: vscode.ViewColumn.Beside,
            })
         }

         const grammar_config: GrammarConfig = { grammar_uri: editor.document.uri, start_rule: null }

         grammars.set(grammar_name, grammar_config)

         executeAndDisplayResults(pegjs_output, input_document_uri, grammar_config)
      }),
      vscode.workspace.registerFileSystemProvider(PEGJS_INPUT_SCHEME, memory_fs)
   )
}

const executeAndDisplayResults = async (
   pegjs_output: vscode.OutputChannel,
   input_document_uri: vscode.Uri,
   config: GrammarConfig
): Promise<void> => {
   pegjs_output.clear()
   pegjs_output.show(true)

   try {
      const [grammar_document, input_document] = [
         await vscode.workspace.openTextDocument(config.grammar_uri),
         await vscode.workspace.openTextDocument(input_document_uri),
      ]

      const parser = PegJs.generate(grammar_document.getText(), {
         allowedStartRules: config.start_rule,
      })

      const input = input_document.getText()
      const result = parser.parse(input, { startRule: config.start_rule })

      pegjs_output.append(JSON.stringify(result, null, 3))
   } catch (error) {
      pegjs_output.append(error.toString())
   }
}
