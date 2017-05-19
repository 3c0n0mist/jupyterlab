// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  JupyterLab, JupyterLabPlugin
} from '@jupyterlab/application';

import {
  ILayoutRestorer, InstanceTracker
} from '@jupyterlab/apputils';

import {
  IEditorServices
} from '@jupyterlab/codeeditor';

import {
  IDocumentRegistry
} from '@jupyterlab/docregistry';

import {
  IEditorTracker, FileEditor, FileEditorFactory
} from '@jupyterlab/fileeditor';

import {
  ILauncher
} from '@jupyterlab/launcher';

import {
   MarkdownCodeBlocks
} from '@jupyterlab/coreutils'


/**
 * The class name for the text editor icon from the default theme.
 */
const EDITOR_ICON_CLASS = 'jp-ImageTextEditor';

/**
 * The name of the factory that creates editor widgets.
 */
const FACTORY = 'Editor';


/**
 * The command IDs used by the fileeditor plugin.
 */
namespace CommandIDs {
  export
  const lineNumbers = 'editor:line-numbers';

  export
  const wordWrap = 'editor:word-wrap';

  export
  const createConsole = 'editor:create-console';

  export
  const runCode = 'editor:run-code';
};


/**
 * The editor tracker extension.
 */
const plugin: JupyterLabPlugin<IEditorTracker> = {
  activate,
  id: 'jupyter.services.editor-tracker',
  requires: [IDocumentRegistry, ILayoutRestorer, IEditorServices],
  optional: [ILauncher],
  provides: IEditorTracker,
  autoStart: true
};

/**
 * Export the plugins as default.
 */
export default plugin;


/**
 * Activate the editor tracker plugin.
 */
function activate(app: JupyterLab, registry: IDocumentRegistry, restorer: ILayoutRestorer, editorServices: IEditorServices, launcher: ILauncher | null): IEditorTracker {
  const id = plugin.id;
  const namespace = 'editor';
  const factory = new FileEditorFactory({
    editorServices,
    factoryOptions: { name: FACTORY, fileExtensions: ['*'], defaultFor: ['*'] }
  });
  const { commands, settings, shell, restored } = app;
  const tracker = new InstanceTracker<FileEditor>({ namespace, shell });
  const hasWidget = () => tracker.currentWidget !== null;

  let lineNumbers = true;
  let wordWrap = true;

  // Handle state restoration.
  restorer.restore(tracker, {
    command: 'file-operations:open',
    args: widget => ({ path: widget.context.path, factory: FACTORY }),
    name: widget => widget.context.path
  });

  // Fetch the initial state of the settings.
  Promise.all([settings.load(id), restored]).then(([settings]) => {
    let cached = settings.get('lineNumbers') as boolean | null;
    lineNumbers = cached === null ? lineNumbers : cached as boolean;

    cached = settings.get('wordWrap') as boolean | null;
    wordWrap = cached === null ? wordWrap : cached as boolean;

    tracker.forEach(widget => {
      widget.editor.lineNumbers = lineNumbers;
      widget.editor.wordWrap = wordWrap;
    });
  });

  factory.widgetCreated.connect((sender, widget) => {
    widget.title.icon = EDITOR_ICON_CLASS;

    // Notify the instance tracker if restore data needs to update.
    widget.context.pathChanged.connect(() => { tracker.save(widget); });
    tracker.add(widget);
    widget.editor.lineNumbers = lineNumbers;
    widget.editor.wordWrap = wordWrap;
  });
  registry.addWidgetFactory(factory);

  // Handle the settings of new widgets.
  tracker.widgetAdded.connect((sender, widget) => {
    const editor = widget.editor;
    editor.lineNumbers = lineNumbers;
    editor.wordWrap = wordWrap;
  });

  // Update the command registry when the notebook state changes.
  tracker.currentChanged.connect(() => {
    if (tracker.size <= 1) {
      commands.notifyCommandChanged(CommandIDs.lineNumbers);
    }
  });

  /**
   * Detect if there is a selection.
   */
  function hasSelection(): boolean {
    let widget = tracker.currentWidget;
    if (!widget) {
      return false;
    }
    const editor = widget.editor;
    const selection = editor.getSelection();
    if (selection.start.column === selection.end.column &&
      selection.start.line === selection.end.line) {
      return false;
    }
    return true;
  }

  commands.addCommand(CommandIDs.lineNumbers, {
    execute: (): Promise<void> => {
      lineNumbers = !lineNumbers;
      tracker.forEach(widget => { widget.editor.lineNumbers = lineNumbers; });
      return settings.set(id, 'lineNumbers', lineNumbers);
    },
    isEnabled: hasWidget,
    isToggled: () => lineNumbers,
    label: 'Line Numbers'
  });

  commands.addCommand(CommandIDs.wordWrap, {
    execute: (): Promise<void> => {
      wordWrap = !wordWrap;
      tracker.forEach(widget => { widget.editor.wordWrap = wordWrap; });
      return settings.set(id, 'wordWrap', wordWrap);
    },
    isEnabled: hasWidget,
    isToggled: () => wordWrap,
    label: 'Word Wrap'
  });

  commands.addCommand(CommandIDs.createConsole, {
    execute: args => {
      const widget = tracker.currentWidget;

      if (!widget) {
        return;
      }

      return commands.execute('console:create', {
        activate: args['activate'],
        path: widget.context.path,
        preferredLanguage: widget.context.model.defaultKernelLanguage
      });
    },
    isEnabled: hasWidget,
    label: 'Create Console for Editor'
  });

  commands.addCommand(CommandIDs.runCode, {
    execute: () => {
      const widget = tracker.currentWidget;

      if (!widget) {
        return;
      }

      var code = ""
      const editor = widget.editor;
      const extension = widget.context.path.substring(widget.context.path.lastIndexOf("."));
      if (!hasSelection() && MarkdownCodeBlocks.isMarkdown(extension)) {
        var codeBlocks = MarkdownCodeBlocks.findMarkdownCodeBlocks(editor.model.value.text);
        for (let codeBlock of codeBlocks) {
          if (codeBlock.startLine <= editor.getSelection().start.line &&
            editor.getSelection().start.line <= codeBlock.endLine) {
            code = codeBlock.code;
            break;
          }
        }
      } else {
        // Get the selected code from the editor.
        const selection = editor.getSelection();
        const start = editor.getOffsetAt(selection.start);
        const end = editor.getOffsetAt(selection.end);
        code = editor.model.value.text.substring(start, end);
        if (start === end) {
          code = editor.getLine(selection.start.line);
        }
      }

      const options: JSONObject = {
        path: widget.context.path,
        code: code,
        activate: false
      };

      // Advance cursor to the next line.
      const cursor = editor.getCursorPosition();

      if (cursor.line + 1 === editor.lineCount) {
        const text = editor.model.value.text;
        editor.model.value.text = text + '\n';
      }
      editor.setCursorPosition({
        column: cursor.column,
        line: cursor.line + 1
      });

      return commands.execute('console:inject', options);
    },
    isEnabled: hasWidget,
    label: 'Run Code'
  });

  // Add a launcher item if the launcher is available.
  if (launcher) {
    launcher.add({
      args: { creatorName: 'Text File' },
      command: 'file-operations:create-from',
      name: 'Text Editor'
    });
  }

  return tracker;
}
