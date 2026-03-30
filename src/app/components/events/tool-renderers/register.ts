import { registerToolRenderer } from './index';
import SearchRenderer from './SearchRenderer';
import ShellCommandRenderer from './ShellCommandRenderer';
import CodingToolRenderer from './CodingToolRenderer';
import KnowledgeSearchRenderer from './KnowledgeSearchRenderer';

registerToolRenderer('internet_search', SearchRenderer);
registerToolRenderer('internet_search_premium', SearchRenderer);
registerToolRenderer('news_search', SearchRenderer);
registerToolRenderer('run_shell_command', ShellCommandRenderer);
registerToolRenderer('run_app', ShellCommandRenderer);
registerToolRenderer('read_file', CodingToolRenderer);
registerToolRenderer('write_file', CodingToolRenderer);
registerToolRenderer('patch_file', CodingToolRenderer);
registerToolRenderer('list_files', CodingToolRenderer);
registerToolRenderer('search_files', CodingToolRenderer);
registerToolRenderer('search_facts', KnowledgeSearchRenderer);
registerToolRenderer('search_conversations', KnowledgeSearchRenderer);
registerToolRenderer('search_conversation', KnowledgeSearchRenderer);
