/** A generic, bounded recovery example; snippets are prompt content, never auto-executed. */
export interface HotPathSnippet {
  id: string;
  description: string;
  tools: string[];
  outcome: string;
  code: string;
}
