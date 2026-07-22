import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const calendarTaskTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: 'Create a Google Calendar event on the user primary calendar.',
      parameters: {
        type: 'object',
        description: 'Details for the calendar event to create.',
        properties: {
          title: {
            type: 'string',
            description: 'Clear event title.',
          },
          start_datetime: {
            type: 'string',
            description: 'Event start as an ISO 8601 datetime. Include timezone or offset when known.',
          },
          end_datetime: {
            type: 'string',
            description: 'Event end as an ISO 8601 datetime. Include timezone or offset when known.',
          },
          attendees: {
            type: 'array',
            description: 'Optional attendee email addresses.',
            items: {
              type: 'string',
              description: 'Attendee email address.',
            },
          },
          description: {
            type: 'string',
            description: 'Optional calendar event description.',
          },
        },
        required: ['title', 'start_datetime', 'end_datetime'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_events',
      description: 'List Google Calendar events in a date range.',
      parameters: {
        type: 'object',
        description: 'Date range for events to list.',
        properties: {
          start_date: {
            type: 'string',
            description: 'Inclusive start date or datetime in ISO 8601 format.',
          },
          end_date: {
            type: 'string',
            description: 'Inclusive end date or datetime in ISO 8601 format.',
          },
        },
        required: ['start_date', 'end_date'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_event',
      description: 'Update an existing Google Calendar event by event_id.',
      parameters: {
        type: 'object',
        description: 'Event identifier and patch fields.',
        properties: {
          event_id: {
            type: 'string',
            description: 'Google Calendar event ID.',
          },
          changes: {
            type: 'object',
            description: 'Fields to update on the event.',
            properties: {
              title: {
                type: 'string',
                description: 'New event title.',
              },
              start_datetime: {
                type: 'string',
                description: 'New event start as an ISO 8601 datetime.',
              },
              end_datetime: {
                type: 'string',
                description: 'New event end as an ISO 8601 datetime.',
              },
              attendees: {
                type: 'array',
                description: 'Replacement attendee email addresses.',
                items: {
                  type: 'string',
                  description: 'Attendee email address.',
                },
              },
              description: {
                type: 'string',
                description: 'Replacement event description.',
              },
            },
            required: [],
            additionalProperties: false,
          },
        },
        required: ['event_id', 'changes'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_event',
      description: 'Delete a Google Calendar event by event_id after the user has explicitly confirmed deletion.',
      parameters: {
        type: 'object',
        description: 'Event identifier to delete.',
        properties: {
          event_id: {
            type: 'string',
            description: 'Google Calendar event ID.',
          },
        },
        required: ['event_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a Google Task in the default task list.',
      parameters: {
        type: 'object',
        description: 'Details for the task to create.',
        properties: {
          title: {
            type: 'string',
            description: 'Task title.',
          },
          due_date: {
            type: 'string',
            description: 'Optional due date or datetime in ISO 8601 format.',
          },
          notes: {
            type: 'string',
            description: 'Optional task notes.',
          },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'List Google Tasks from the default task list.',
      parameters: {
        type: 'object',
        description: 'Optional task filters.',
        properties: {
          due_before: {
            type: 'string',
            description: 'Optional upper due date or datetime in ISO 8601 format.',
          },
          status: {
            type: 'string',
            description: 'Optional task status filter.',
            enum: ['needsAction', 'completed'],
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Update an existing Google Task by task_id.',
      parameters: {
        type: 'object',
        description: 'Task identifier and patch fields.',
        properties: {
          task_id: {
            type: 'string',
            description: 'Google Task ID.',
          },
          changes: {
            type: 'object',
            description: 'Fields to update on the task.',
            properties: {
              title: {
                type: 'string',
                description: 'New task title.',
              },
              due_date: {
                type: ['string', 'null'],
                description: 'New due date or datetime in ISO 8601 format, or null to remove the due date.',
              },
              notes: {
                type: 'string',
                description: 'Replacement task notes.',
              },
              status: {
                type: 'string',
                description: 'New task status.',
                enum: ['needsAction', 'completed'],
              },
            },
            required: [],
            additionalProperties: false,
          },
        },
        required: ['task_id', 'changes'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Delete a Google Task by task_id after the user has explicitly confirmed deletion.',
      parameters: {
        type: 'object',
        description: 'Task identifier to delete.',
        properties: {
          task_id: {
            type: 'string',
            description: 'Google Task ID.',
          },
        },
        required: ['task_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_event',
      description: 'Resolve a natural language event reference to a real Google Calendar event_id.',
      parameters: {
        type: 'object',
        description: 'Search query and optional date range.',
        properties: {
          query: {
            type: 'string',
            description:
              'Natural language event title or detail terms. Put date-only words like "Friday" into start_date/end_date instead of relying on them as text search terms.',
          },
          start_date: {
            type: 'string',
            description: 'Optional inclusive start date or datetime in ISO 8601 format.',
          },
          end_date: {
            type: 'string',
            description: 'Optional inclusive end date or datetime in ISO 8601 format.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_task',
      description: 'Resolve a natural language task reference to a real Google Task task_id.',
      parameters: {
        type: 'object',
        description: 'Search query and optional status filter.',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language task description, such as "my grocery task".',
          },
          status: {
            type: 'string',
            description: 'Optional task status filter.',
            enum: ['needsAction', 'completed'],
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
];
