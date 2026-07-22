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

export const SCENARIOS: Scenario[] = [
  {
    id: 'create_event',
    name: '📅 Schedule Event',
    description: 'Create a calendar event with a clear title, date, and time.',
    starters: ['Schedule a team meeting tomorrow at 3 PM', 'Book a coffee chat with Sarah at 10 AM on Friday'],
  },
  {
    id: 'list_events',
    name: '🗓️ View Calendar',
    description: 'See what\'s on your calendar for a specific time range.',
    starters: ['What does my calendar look like this week?', 'Do I have any meetings tomorrow?'],
  },
  {
    id: 'create_task',
    name: '✅ Create Task',
    description: 'Add a new task with an optional due date.',
    starters: ['Create a task to submit the monthly report by Monday', 'Remind me to buy groceries this weekend'],
  },
  {
    id: 'show_tasks',
    name: '📋 View Tasks',
    description: 'List your pending or completed tasks.',
    starters: ['Show me all tasks due this week', 'What tasks do I have pending?'],
  },
  {
    id: 'clarification',
    name: '💬 Ambiguous Request',
    description: 'The assistant will ask for missing details instead of guessing.',
    starters: ['Schedule lunch with John', 'Move my Friday meeting'],
  },
  {
    id: 'delete_confirm',
    name: '🗑️ Delete with Confirmation',
    description: 'Delete requests require explicit confirmation first.',
    starters: ['Delete my dentist appointment', 'Remove the standup meeting on Friday'],
  },
];

export const INITIAL_MESSAGES: Message[] = [
  {
    id: 'welcome',
    sender: 'assistant',
    text: 'Hello there! I am your Google Workspace personal assistant. I can use OpenAI tool calling to create, find, update, list, and delete Google Calendar events and Google Tasks.\n\nChoose a starter prompt or type a natural-language request.',
    timestamp: new Date(),
  },
];

