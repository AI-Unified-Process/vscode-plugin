import * as vscode from 'vscode';
import { WorkspaceIndex } from './workspaceIndex';

const OFFERED_KEY = 'aiup.useCaseAnnotationOffered';

const USE_CASE_TEMPLATE = `import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface UseCase {

\tString id();

\tString scenario() default "Main Success Scenario";

\tString[] businessRules() default {};

}
`;

/**
 * The VS Code port of the IntelliJ setup balloon: when the workspace contains
 * Markdown Use Case specs but no `UseCase` annotation type, offer (once per
 * workspace) to scaffold `UseCase.java` into a chosen source root.
 */
export async function maybeOfferScaffold(
  context: vscode.ExtensionContext,
  index: WorkspaceIndex,
): Promise<void> {
  if (context.workspaceState.get<boolean>(OFFERED_KEY)) {
    return;
  }
  await index.ensureReady();
  if (!index.hasAnyUseCaseSpec() || index.hasUseCaseAnnotationType()) {
    return;
  }
  await context.workspaceState.update(OFFERED_KEY, true);
  const action = await vscode.window.showInformationMessage(
    'This workspace has AIUP Use Case specs but no @UseCase annotation type. ' +
      'Create UseCase.java so tests can reference their specs?',
    'Create UseCase.java',
  );
  if (action) {
    await vscode.commands.executeCommand('aiup.createUseCaseJava');
  }
}

export async function createUseCaseJava(): Promise<void> {
  const root = await pickSourceRoot();
  if (!root) {
    return;
  }
  const packageName = await vscode.window.showInputBox({
    title: 'Package for UseCase.java',
    prompt: 'Java package the annotation is created in (empty for the default package)',
    placeHolder: 'com.example.app',
    validateInput: (value) =>
      value === '' || /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(value)
        ? undefined
        : 'Not a valid Java package name',
  });
  if (packageName === undefined) {
    return;
  }

  const directory =
    packageName === ''
      ? root
      : vscode.Uri.joinPath(root, ...packageName.split('.'));
  const file = vscode.Uri.joinPath(directory, 'UseCase.java');

  try {
    await vscode.workspace.fs.stat(file);
    void vscode.window.showInformationMessage('UseCase.java already exists — opening it.');
  } catch {
    const header = packageName === '' ? '' : `package ${packageName};\n\n`;
    await vscode.workspace.fs.createDirectory(directory);
    await vscode.workspace.fs.writeFile(
      file,
      new TextEncoder().encode(header + USE_CASE_TEMPLATE),
    );
  }
  await vscode.window.showTextDocument(file);
}

async function pickSourceRoot(): Promise<vscode.Uri | undefined> {
  const candidates: { label: string; uri: vscode.Uri }[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const relative of ['src/test/java', 'src/main/java']) {
      const uri = vscode.Uri.joinPath(folder.uri, ...relative.split('/'));
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type & vscode.FileType.Directory) {
          candidates.push({ label: `${folder.name}/${relative}`, uri });
        }
      } catch {
        // not a source root of this folder
      }
    }
  }

  const browseItem = { label: 'Choose folder…', uri: undefined as vscode.Uri | undefined };
  const picked = await vscode.window.showQuickPick([...candidates, browseItem], {
    title: 'Source root for UseCase.java',
  });
  if (!picked) {
    return undefined;
  }
  if (picked.uri) {
    return picked.uri;
  }
  const chosen = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Use as source root',
  });
  return chosen?.[0];
}
