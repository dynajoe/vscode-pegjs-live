import * as vscode from 'vscode'
import * as Path from 'path'
import { MemFS } from './memFs'
const PegJs = require('pegjs')

const PEGJS_INPUT_SCHEME = 'pegjsin'

interface GrammarConfig {
   name: string
   key: string
   start_rule: string | undefined
   grammar_uri: vscode.Uri
   input_uri: vscode.Uri
   timeout?: NodeJS.Timer
   grammar_text?: string
   parser?: any
}

export function activate(context: vscode.ExtensionContext) {
   const pegjs_output = vscode.window.createOutputChannel('PEG.js')
   const memory_fs = new MemFS()
   const grammars = new Map<string, GrammarConfig>()

   const grammarNameFromUri = (uri: vscode.Uri): string => {
      return Path.basename(uri.fsPath)
         .replace(/.pegjs$/, '')
         .replace(/^[(][^)]+[)]__/, '')
   }

   const trackGrammar = (grammar_document_uri: vscode.Uri, start_rule?: string): GrammarConfig => {
      const grammar_name = grammarNameFromUri(grammar_document_uri)
      const key = `${grammar_name}:${start_rule || '*'}`

      const input_document_uri = start_rule
         ? vscode.Uri.parse(`${PEGJS_INPUT_SCHEME}:/(${start_rule})__${grammar_name}`)
         : vscode.Uri.parse(`${PEGJS_INPUT_SCHEME}:/${grammar_name}`)

      if (!memory_fs.exists(input_document_uri)) {
         memory_fs.writeFile(input_document_uri, Buffer.from(''), {
            create: true,
            overwrite: true,
         })
      }

      const is_input_document_open = vscode.workspace.textDocuments.find(d => d.uri === input_document_uri)

      if (!is_input_document_open) {
         vscode.window.showTextDocument(input_document_uri, {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true,
         })
      }

      grammars.set(key, {
         name: grammar_name,
         key: key,
         start_rule: start_rule,
         grammar_uri: grammar_document_uri,
         input_uri: input_document_uri,
      })

      return grammars.get(key)!
   }

   const documents_changed = vscode.workspace.onDidChangeTextDocument(async e => {
      const document_uri_string = e.document.uri.toString()

      for (const config of grammars.values()) {
         if (
            config.grammar_uri.toString() === document_uri_string ||
            config.input_uri.toString() === document_uri_string
         ) {
            await executeAndDisplayResults(pegjs_output, config)
         }
      }
   })

   const documents_closed = vscode.workspace.onDidCloseTextDocument(async e => {
      const to_remove = [...grammars.values()].filter(config => {
         return config.grammar_uri === e.uri || config.input_uri === e.uri
      })

      to_remove.forEach(config => {
         grammars.delete(config.key)
      })
   })

   context.subscriptions.push(
      documents_changed,
      documents_closed,
      pegjs_output,
      vscode.commands.registerTextEditorCommand('editor.pegjsLiveFromRule', async editor => {
         const word_range = editor.document.getWordRangeAtPosition(
            editor.selection.start,
            /[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*/
         )

         if (word_range != null) {
            const rule_name = editor.document.getText(word_range)
            const grammar_config = trackGrammar(editor.document.uri, rule_name)

            debounceExecution(pegjs_output, grammar_config)
         }
      }),
      vscode.commands.registerTextEditorCommand('editor.pegjsLive', async editor => {
         const grammar_config = trackGrammar(editor.document.uri)
         debounceExecution(pegjs_output, grammar_config)
      }),
      vscode.workspace.registerFileSystemProvider(PEGJS_INPUT_SCHEME, memory_fs)
   )
}

const debounceExecution = (output: vscode.OutputChannel, config: GrammarConfig) => {
   clearTimeout(config.timeout!)

   config.timeout = setTimeout(() => {
      executeAndDisplayResults(output, config)
   }, 300)
}

const executeAndDisplayResults = async (output: vscode.OutputChannel, config: GrammarConfig): Promise<void> => {
   output.clear()
   output.show(true)
   output.appendLine(`${config.name} ${config.start_rule ? `(${config.start_rule})` : ''}`)

   try {
      const [grammar_document, input_document] = [
         await vscode.workspace.openTextDocument(config.grammar_uri),
         await vscode.workspace.openTextDocument(config.input_uri),
      ]

      const grammar_text = grammar_document.getText()

      config.parser =
         grammar_text === config.grammar_text
            ? config.parser
            : PegJs.generate(
                 grammar_text,
                 config.start_rule
                    ? {
                         allowedStartRules: [config.start_rule],
                      }
                    : undefined
              )

      config.grammar_text = grammar_text

      const input = input_document.getText()
      const result = config.parser.parse(input, config.start_rule ? { startRule: config.start_rule } : undefined)

      output.appendLine(JSON.stringify(result, null, 3))
   } catch (error) {
      output.append(error.toString())
   }
}
