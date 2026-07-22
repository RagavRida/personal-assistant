export interface Task {
  id: string;
  title: string;
  due: string;
  completed: boolean;
  category: 'work' | 'personal' | 'urgent';
}

export interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  status?: 'normal' | 'thinking' | 'tool-action' | 'error' | 'confirm';
  toolActionText?: string;
  confirmAction?: string;
  action?: 'reauth' | 'retry';
  retryText?: string;
  tasks?: Task[];
  contextItems?: ConversationContextItem[];
  pendingConfirmation?: PendingConfirmation;
  timestamp: Date;
}

export interface ConversationContextItem {
  type: 'event' | 'task';
  id: string;
  title: string;
  start?: string;
  end?: string;
  due?: string;
  status?: string;
}

export interface PendingConfirmation {
  type: 'delete_event' | 'delete_task';
  id: string;
  title: string;
  start?: string;
  end?: string;
  due?: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  starters: string[];
}

export const SCENARIOS: Record<string, Scenario> = {
  create_event: {
    id: 'create_event',
    name: 'Create Calendar Event',
    description: 'Try a direct scheduling request with a clear title, date, and time.',
    starters: ['Schedule a project review for tomorrow at 2 PM', 'Book a quick coffee chat with Sarah at 10 AM'],
  },
  clarification: {
    id: 'clarification',
    name: 'Clarifying Question',
    description: 'Try a request that should make the assistant ask for missing details.',
    starters: ['Schedule team lunch this Friday', 'Remind me to update my report'],
  },
  delete_confirm: {
    id: 'delete_confirm',
    name: 'Delete Confirmation',
    description: 'Try a delete request that should require plain-text confirmation first.',
    starters: ['Delete the standup meeting on Friday', 'Clear my entire afternoon calendar'],
  },
  error_state: {
    id: 'error_state',
    name: 'Missing Item',
    description: 'Try a request where the assistant needs to search and may find no match.',
    starters: ['Move my made-up event to Monday', 'Find my task about buying a moon base'],
  },
  show_tasks: {
    id: 'show_tasks',
    name: 'Show Weekly Tasks',
    description: 'Try live Google Tasks listing and task-focused requests.',
    starters: ['What are my tasks for this week?', 'Show my pending checklists'],
  },
};

export const INITIAL_MESSAGES: Message[] = [
  {
    id: 'welcome',
    sender: 'assistant',
    text: 'Hello there! I am your Google Workspace personal assistant. I can use OpenAI tool calling to create, find, update, list, and delete Google Calendar events and Google Tasks.\n\nChoose a starter prompt or type a natural-language request.',
    timestamp: new Date(),
  },
];
