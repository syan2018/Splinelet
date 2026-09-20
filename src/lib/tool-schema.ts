export type ToolProperty = {
  type?: 'array' | 'boolean' | 'integer' | 'number' | 'object' | 'string';
  enum?: Array<string | number>;
  items?: ToolProperty;
  properties?: Record<string, ToolProperty>;
  oneOf?: ToolProperty[];
  additionalProperties?: boolean;
  description?: string;
  required?: string[];
  minimum?: number;
  maximum?: number;
};

export type ToolDefinition = {
  description: string;
  properties: Record<string, ToolProperty>;
  required?: string[];
  readOnly?: boolean;
  /** Requires document.get's revision before a compatibility call is routed. */
  compatibilityWrite?: boolean;
};

export type ToolCatalog = Record<string, ToolDefinition>;
