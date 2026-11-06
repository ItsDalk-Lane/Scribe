export function buildSkillEditorContent(name: string, description: string, body: string): string {
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n${body}`;
}
