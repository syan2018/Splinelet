export type ToolProperty = {
  type?: 'array' | 'boolean' | 'integer' | 'number' | 'object' | 'string';
  enum?: string[];
  items?: ToolProperty;
  properties?: Record<string, ToolProperty>;
  additionalProperties?: boolean;
  description?: string;
  minimum?: number;
  maximum?: number;
};

export type ToolDefinition = {
  description: string;
  properties: Record<string, ToolProperty>;
  required?: string[];
  readOnly?: boolean;
};

export type ToolCatalog = Record<string, ToolDefinition>;
