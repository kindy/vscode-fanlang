import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
  InitializeResult,
} from "vscode-languageserver";

import { Fan } from "./fan";

import { TextDocument as RawTextDocument } from "vscode-languageserver-textdocument";

type TextDocument = RawTextDocument & { fan?: Fan | undefined };
const TextDocument = RawTextDocument;

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// console.log('server', connection);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      hoverProvider: true,
      documentSymbolProvider: true,
      referencesProvider: true,
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(() => {
      connection.console.log("Workspace folder change event received.");
    });
  }
});

function reparse(document: TextDocument) {
  markForReparsing(document);
  ensureParsed(document);
}

documents.onDidChangeContent((change) => {
  reparse(change.document);
});

function markForReparsing(document: TextDocument) {
  document["fan"] = undefined;
}

function ensureParsed(document: TextDocument): Fan | undefined {
  if (!document["fan"]) {
    document["fan"] = Fan.process(document);
  }

  return document["fan"];
}

connection.onReferences((params) => {
  const uri = params.textDocument.uri;
  const document = documents.get(uri);
  const pos = params.position;

  if (!document) {
    return null;
  }

  const offset = document.offsetAt(pos);
  return ensureParsed(document)?.getReferences(offset) || null;
});

connection.onDocumentSymbol((params) => {
  // console.log("onDocumentSymbol", params);

  const uri = params.textDocument.uri;
  const document = documents.get(uri);

  if (!document) {
    return null;
  }

  return ensureParsed(document)?.getSymbols() || null;
});

connection.onHover((params) => {
  const uri = params.textDocument.uri;
  const document = documents.get(uri);
  const pos = params.position;

  if (!document) {
    return null;
  }

  const offset = document.offsetAt(pos);
  return ensureParsed(document)?.getHover(offset) || null;
});

connection.onDefinition((params) => {
  const uri = params.textDocument.uri;
  const document = documents.get(uri);
  const pos = params.position;

  if (!document) {
    return null;
  }

  const offset = document.offsetAt(pos);
  return ensureParsed(document)?.getDefinition(offset) || null;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();