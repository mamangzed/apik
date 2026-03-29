import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Plus, RotateCcw, Sparkles, Trash2, Upload } from 'lucide-react';
import { useAppStore } from '../../store';
import { createAutoFormConfigFromRequest } from '../../lib/requestForm';
import { RequestFormConfig, RequestFormField, RequestFormFieldTarget, RequestFormFieldType, RequestFormTemplate } from '../../types';

function createFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createMappingId(): string {
  return `mapping_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createOptionId(): string {
  return `option_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneFormConfig(config: RequestFormConfig): RequestFormConfig {
  return JSON.parse(JSON.stringify(config)) as RequestFormConfig;
}

function normalizeImportedFormConfig(raw: unknown): RequestFormConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const input = raw as Record<string, unknown>;
  const fieldsSource = Array.isArray(input.fields) ? input.fields : [];
  const mappingsSource = Array.isArray(input.responseMappings) ? input.responseMappings : [];

  const fields: RequestFormField[] = fieldsSource.map((fieldRaw) => {
    const field = (fieldRaw && typeof fieldRaw === 'object' ? fieldRaw : {}) as Record<string, unknown>;
    const optionsSource = Array.isArray(field.options) ? field.options : [];

    return {
      id: typeof field.id === 'string' ? field.id : createFieldId(),
      name: typeof field.name === 'string' ? field.name : `field_${Math.random().toString(36).slice(2, 7)}`,
      label: typeof field.label === 'string' ? field.label : 'Field',
      type: typeof field.type === 'string' ? (field.type as RequestFormFieldType) : 'text',
      required: Boolean(field.required),
      target: typeof field.target === 'string' ? (field.target as RequestFormFieldTarget) : 'body-json',
      targetKey: typeof field.targetKey === 'string' ? field.targetKey : 'value',
      placeholder: typeof field.placeholder === 'string' ? field.placeholder : '',
      defaultValue: typeof field.defaultValue === 'string' ? field.defaultValue : '',
      description: typeof field.description === 'string' ? field.description : '',
      options: optionsSource.map((optRaw) => {
        const option = (optRaw && typeof optRaw === 'object' ? optRaw : {}) as Record<string, unknown>;
        return {
          id: typeof option.id === 'string' ? option.id : createOptionId(),
          label: typeof option.label === 'string' ? option.label : 'Option',
          value: typeof option.value === 'string' ? option.value : 'option',
        };
      }),
      min: typeof field.min === 'number' ? field.min : undefined,
      max: typeof field.max === 'number' ? field.max : undefined,
      step: typeof field.step === 'number' ? field.step : undefined,
      pattern: typeof field.pattern === 'string' ? field.pattern : '',
      accept: typeof field.accept === 'string' ? field.accept : '',
      multiple: Boolean(field.multiple),
      repeatable: Boolean(field.repeatable),
      repeatSeparator:
        field.repeatSeparator === 'comma' || field.repeatSeparator === 'json-lines' ? field.repeatSeparator : 'newline',
      group: typeof field.group === 'string' ? field.group : 'General',
      visibilityDependsOnFieldName:
        typeof field.visibilityDependsOnFieldName === 'string' ? field.visibilityDependsOnFieldName : '',
      visibilityOperator:
        field.visibilityOperator === 'not-equals' ||
        field.visibilityOperator === 'contains' ||
        field.visibilityOperator === 'filled' ||
        field.visibilityOperator === 'not-filled'
          ? field.visibilityOperator
          : 'equals',
      visibilityValue: typeof field.visibilityValue === 'string' ? field.visibilityValue : '',
    };
  });

  const responseMappings = mappingsSource
    .map((mappingRaw) => {
      const mapping = (mappingRaw && typeof mappingRaw === 'object' ? mappingRaw : {}) as Record<string, unknown>;
      return {
        id: typeof mapping.id === 'string' ? mapping.id : createMappingId(),
        sourceRequestId: typeof mapping.sourceRequestId === 'string' ? mapping.sourceRequestId : '',
        responsePath: typeof mapping.responsePath === 'string' ? mapping.responsePath : '',
        targetFieldId: typeof mapping.targetFieldId === 'string' ? mapping.targetFieldId : '',
      };
    })
    .filter((entry) => entry.targetFieldId);

  const templatesSource = Array.isArray(input.templates) ? input.templates : [];
  const templates: RequestFormTemplate[] = templatesSource
    .map((templateRaw) => {
      const template = (templateRaw && typeof templateRaw === 'object' ? templateRaw : {}) as Record<string, unknown>;
      const templateFieldsSource = Array.isArray(template.fields) ? template.fields : [];
      const templateFields = templateFieldsSource
        .map((fieldRaw) => normalizeImportedFormConfig({ enabled: true, fields: [fieldRaw], responseMappings: [] })?.fields?.[0])
        .filter(Boolean) as RequestFormField[];

      return {
        id: typeof template.id === 'string' ? template.id : `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: typeof template.name === 'string' ? template.name : 'Untitled Template',
        fields: templateFields,
        createdAt: typeof template.createdAt === 'number' ? template.createdAt : Date.now(),
      };
    })
    .filter((template) => template.fields.length > 0);

  return {
    enabled: input.enabled !== false,
    fields,
    authRequirement: {
      enabled: Boolean((input.authRequirement as Record<string, unknown> | undefined)?.enabled),
      sourceRequestId:
        typeof (input.authRequirement as Record<string, unknown> | undefined)?.sourceRequestId === 'string'
          ? String((input.authRequirement as Record<string, unknown>).sourceRequestId)
          : '',
      tokenPath:
        typeof (input.authRequirement as Record<string, unknown> | undefined)?.tokenPath === 'string'
          ? String((input.authRequirement as Record<string, unknown>).tokenPath)
          : 'token',
      scheme:
        (input.authRequirement as Record<string, unknown> | undefined)?.scheme === 'Token'
          ? 'Token'
          : (input.authRequirement as Record<string, unknown> | undefined)?.scheme === 'Raw'
            ? 'Raw'
            : 'Bearer',
      headerName:
        typeof (input.authRequirement as Record<string, unknown> | undefined)?.headerName === 'string'
          ? String((input.authRequirement as Record<string, unknown>).headerName)
          : 'Authorization',
    },
    responseMappings,
    scripts: {
      beforeSubmit:
        typeof (input.scripts as Record<string, unknown> | undefined)?.beforeSubmit === 'string'
          ? String((input.scripts as Record<string, unknown>).beforeSubmit)
          : '',
      afterResponse:
        typeof (input.scripts as Record<string, unknown> | undefined)?.afterResponse === 'string'
          ? String((input.scripts as Record<string, unknown>).afterResponse)
          : '',
    },
    templates,
  };
}

type FormTemplateId = 'login' | 'register' | 'address' | 'payment';

type ImportPreview = {
  valid: boolean;
  nextFieldCount: number;
  nextMappingCount: number;
  addedFields: string[];
  removedFields: string[];
  error?: string;
};

function createDefaultFormConfig(): RequestFormConfig {
  return {
    enabled: false,
    fields: [],
    authRequirement: {
      enabled: false,
      sourceRequestId: '',
      tokenPath: 'token',
      scheme: 'Bearer',
      headerName: 'Authorization',
    },
    responseMappings: [],
    scripts: {
      beforeSubmit: '',
      afterResponse: '',
    },
    templates: [],
  };
}

function createCustomField(): RequestFormField {
  return {
    id: createFieldId(),
    name: `field_${Math.random().toString(36).slice(2, 7)}`,
    label: 'Custom Field',
    type: 'text',
    required: false,
    target: 'body-json',
    targetKey: 'customField',
    placeholder: '',
    defaultValue: '',
    description: '',
    options: [],
    min: undefined,
    max: undefined,
    step: undefined,
    pattern: '',
    accept: '',
    multiple: false,
    repeatable: false,
    repeatSeparator: 'newline',
    group: 'General',
    visibilityDependsOnFieldName: '',
    visibilityOperator: 'equals',
    visibilityValue: '',
  };
}

function createTemplateField(overrides: Partial<RequestFormField>): RequestFormField {
  return {
    ...createCustomField(),
    id: createFieldId(),
    name: overrides.name || `field_${Math.random().toString(36).slice(2, 7)}`,
    label: overrides.label || 'Field',
    type: overrides.type || 'text',
    target: overrides.target || 'body-json',
    targetKey: overrides.targetKey || 'value',
    group: overrides.group || 'General',
    ...overrides,
  };
}

const FIELD_TYPES: RequestFormFieldType[] = [
  'text',
  'password',
  'number',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'email',
  'tel',
  'url',
  'date',
  'time',
  'datetime-local',
  'range',
  'color',
  'file',
  'address',
  'json',
];
const FIELD_TARGETS: RequestFormFieldTarget[] = [
  'param',
  'header',
  'body-json',
  'body-form',
  'auth-token',
  'auth-username',
  'auth-password',
  'auth-api-key-value',
];

export default function DocsTab() {
  const { tabs, activeTabId, updateActiveRequest, collections } = useAppStore();
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null);
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null);
  const [showSchemaImport, setShowSchemaImport] = useState(false);
  const [schemaInput, setSchemaInput] = useState('');
  const [schemaMessage, setSchemaMessage] = useState('');
  const [undoSnapshot, setUndoSnapshot] = useState<RequestFormConfig | null>(null);
  const [customTemplateName, setCustomTemplateName] = useState('');
  const tab = tabs.find((entry) => entry.id === activeTabId);
  if (!tab) return null;

  const request = tab.requestState.request;
  const collectionId = tab.requestState.collectionId;
  const collection = collections.find((entry) => entry.id === collectionId);
  const availableAuthRequests = (collection?.requests || []).filter((entry) => entry.id !== request.id);

  const formConfig = request.formConfig || createDefaultFormConfig();
  const savedTemplates = formConfig.templates || [];
  const legacyTemplatesStorageKey = `apik.formTemplates.${request.id}`;

  const updateFormConfig = (updates: Partial<RequestFormConfig>) => {
    updateActiveRequest({
      formConfig: {
        ...formConfig,
        ...updates,
      },
    });
  };

  useEffect(() => {
    if (savedTemplates.length > 0) {
      return;
    }

    try {
      const raw = localStorage.getItem(legacyTemplatesStorageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const migrated = parsed
        .map((templateRaw) => {
          const template = (templateRaw && typeof templateRaw === 'object' ? templateRaw : {}) as Record<string, unknown>;
          const templateFieldsSource = Array.isArray(template.fields) ? template.fields : [];
          const fields = templateFieldsSource
            .map((fieldRaw) => normalizeImportedFormConfig({ enabled: true, fields: [fieldRaw], responseMappings: [] })?.fields?.[0])
            .filter(Boolean) as RequestFormField[];

          return {
            id: typeof template.id === 'string' ? template.id : `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: typeof template.name === 'string' ? template.name : 'Untitled Template',
            fields,
            createdAt: typeof template.createdAt === 'number' ? template.createdAt : Date.now(),
          };
        })
        .filter((template) => template.fields.length > 0) as RequestFormTemplate[];

      if (migrated.length === 0) {
        return;
      }

      updateFormConfig({ templates: migrated });
      localStorage.removeItem(legacyTemplatesStorageKey);
      setSchemaMessage(`Migrated ${migrated.length} local template(s). Click Save to sync.`);
    } catch {
      // Ignore legacy template migration errors.
    }
  }, [legacyTemplatesStorageKey, savedTemplates.length]);

  const persistSavedTemplates = (next: RequestFormTemplate[]) => {
    updateFormConfig({ templates: next });
  };

  const updateField = (fieldId: string, updates: Partial<RequestFormField>) => {
    updateFormConfig({
      fields: formConfig.fields.map((field) => (field.id === fieldId ? { ...field, ...updates } : field)),
    });
  };

  const removeField = (fieldId: string) => {
    updateFormConfig({
      fields: formConfig.fields.filter((field) => field.id !== fieldId),
      responseMappings: (formConfig.responseMappings || []).filter((mapping) => mapping.targetFieldId !== fieldId),
    });
  };

  const addFieldOption = (fieldId: string) => {
    updateFormConfig({
      fields: formConfig.fields.map((field) => {
        if (field.id !== fieldId) {
          return field;
        }

        const current = field.options || [];
        return {
          ...field,
          options: [
            ...current,
            {
              id: createOptionId(),
              label: `Option ${current.length + 1}`,
              value: `option_${current.length + 1}`,
            },
          ],
        };
      }),
    });
  };

  const updateFieldOption = (fieldId: string, optionId: string, updates: { label?: string; value?: string }) => {
    updateFormConfig({
      fields: formConfig.fields.map((field) => {
        if (field.id !== fieldId) {
          return field;
        }

        return {
          ...field,
          options: (field.options || []).map((option) => (option.id === optionId ? { ...option, ...updates } : option)),
        };
      }),
    });
  };

  const removeFieldOption = (fieldId: string, optionId: string) => {
    updateFormConfig({
      fields: formConfig.fields.map((field) => {
        if (field.id !== fieldId) {
          return field;
        }

        return {
          ...field,
          options: (field.options || []).filter((option) => option.id !== optionId),
        };
      }),
    });
  };

  const moveField = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) {
      return;
    }

    const sourceIndex = formConfig.fields.findIndex((field) => field.id === sourceId);
    const targetIndex = formConfig.fields.findIndex((field) => field.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const reordered = [...formConfig.fields];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    updateFormConfig({ fields: reordered });
  };

  const groupOrder = Array.from(
    new Set(formConfig.fields.map((field) => (field.group || 'General').trim() || 'General')),
  );

  const reorderByGroupOrder = (order: string[]) => {
    const grouped = new Map<string, RequestFormField[]>();
    formConfig.fields.forEach((field) => {
      const key = (field.group || 'General').trim() || 'General';
      grouped.set(key, [...(grouped.get(key) || []), field]);
    });

    const reordered: RequestFormField[] = [];
    order.forEach((groupName) => {
      (grouped.get(groupName) || []).forEach((field) => reordered.push(field));
    });

    updateFormConfig({ fields: reordered });
  };

  const moveGroupBy = (groupName: string, delta: number) => {
    const idx = groupOrder.indexOf(groupName);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= groupOrder.length) {
      return;
    }

    const next = [...groupOrder];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    reorderByGroupOrder(next);
  };

  const moveGroupTo = (sourceGroup: string, targetGroup: string) => {
    if (!sourceGroup || !targetGroup || sourceGroup === targetGroup) {
      return;
    }
    const sourceIdx = groupOrder.indexOf(sourceGroup);
    const targetIdx = groupOrder.indexOf(targetGroup);
    if (sourceIdx < 0 || targetIdx < 0) {
      return;
    }

    const next = [...groupOrder];
    const [moved] = next.splice(sourceIdx, 1);
    next.splice(targetIdx, 0, moved);
    reorderByGroupOrder(next);
  };

  const applyTemplate = (templateId: FormTemplateId) => {
    const templates: Record<FormTemplateId, RequestFormField[]> = {
      login: [
        createTemplateField({ name: 'username', label: 'Username', type: 'text', target: 'body-json', targetKey: 'username', required: true, group: 'Credentials' }),
        createTemplateField({ name: 'password', label: 'Password', type: 'password', target: 'body-json', targetKey: 'password', required: true, group: 'Credentials' }),
      ],
      register: [
        createTemplateField({ name: 'name', label: 'Full Name', type: 'text', target: 'body-json', targetKey: 'name', required: true, group: 'Registration' }),
        createTemplateField({ name: 'email', label: 'Email', type: 'email', target: 'body-json', targetKey: 'email', required: true, group: 'Registration' }),
        createTemplateField({ name: 'password', label: 'Password', type: 'password', target: 'body-json', targetKey: 'password', required: true, group: 'Registration' }),
        createTemplateField({ name: 'confirmPassword', label: 'Confirm Password', type: 'password', target: 'body-json', targetKey: 'confirmPassword', required: true, group: 'Registration' }),
      ],
      address: [
        createTemplateField({ name: 'shippingAddress', label: 'Shipping Address', type: 'address', target: 'body-json', targetKey: 'shippingAddress', required: true, group: 'Address' }),
        createTemplateField({ name: 'notes', label: 'Address Notes', type: 'textarea', target: 'body-json', targetKey: 'shippingAddress.notes', group: 'Address' }),
      ],
      payment: [
        createTemplateField({ name: 'cardNumber', label: 'Card Number', type: 'text', target: 'body-json', targetKey: 'payment.cardNumber', required: true, group: 'Payment' }),
        createTemplateField({ name: 'expiry', label: 'Expiry', type: 'text', target: 'body-json', targetKey: 'payment.expiry', required: true, group: 'Payment', placeholder: 'MM/YY' }),
        createTemplateField({ name: 'cvv', label: 'CVV', type: 'password', target: 'body-json', targetKey: 'payment.cvv', required: true, group: 'Payment' }),
        createTemplateField({ name: 'billingZip', label: 'Billing ZIP', type: 'text', target: 'body-json', targetKey: 'payment.billingZip', required: true, group: 'Payment' }),
      ],
    };

    updateFormConfig({
      fields: [...formConfig.fields, ...templates[templateId]],
    });
  };

  const cloneFieldsForInsert = (fields: RequestFormField[]): RequestFormField[] => {
    const usedNames = new Set(formConfig.fields.map((field) => field.name));
    return fields.map((field) => {
      const baseName = field.name || `field_${Math.random().toString(36).slice(2, 7)}`;
      let uniqueName = baseName;
      let idx = 2;
      while (usedNames.has(uniqueName)) {
        uniqueName = `${baseName}_${idx}`;
        idx += 1;
      }
      usedNames.add(uniqueName);

      return {
        ...field,
        id: createFieldId(),
        name: uniqueName,
        options: (field.options || []).map((option) => ({ ...option, id: createOptionId() })),
      };
    });
  };

  const handleSaveCurrentAsTemplate = () => {
    const name = customTemplateName.trim();
    if (!name) {
      setSchemaMessage('Template name is required.');
      return;
    }
    if (formConfig.fields.length === 0) {
      setSchemaMessage('Cannot save template: no fields in current schema.');
      return;
    }

    const next: RequestFormTemplate[] = [
      {
        id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        fields: cloneFormConfig(formConfig).fields,
        createdAt: Date.now(),
      },
      ...savedTemplates,
    ].slice(0, 20);

    persistSavedTemplates(next);
    setCustomTemplateName('');
    setSchemaMessage(`Template \"${name}\" saved.`);
  };

  const handleApplySavedTemplate = (templateId: string) => {
    const template = savedTemplates.find((entry) => entry.id === templateId);
    if (!template) {
      return;
    }

    updateFormConfig({ fields: [...formConfig.fields, ...cloneFieldsForInsert(template.fields)] });
    setSchemaMessage(`Template \"${template.name}\" applied.`);
  };

  const handleDeleteSavedTemplate = (templateId: string) => {
    const target = savedTemplates.find((entry) => entry.id === templateId);
    const next = savedTemplates.filter((entry) => entry.id !== templateId);
    persistSavedTemplates(next);
    if (target) {
      setSchemaMessage(`Template \"${target.name}\" deleted.`);
    }
  };

  const handleRenameSavedTemplate = (templateId: string) => {
    const target = savedTemplates.find((entry) => entry.id === templateId);
    if (!target) {
      return;
    }

    const nextName = window.prompt('Rename template', target.name);
    if (nextName === null) {
      return;
    }

    const trimmed = nextName.trim();
    if (!trimmed) {
      setSchemaMessage('Template name cannot be empty.');
      return;
    }

    const next = savedTemplates.map((entry) => (entry.id === templateId ? { ...entry, name: trimmed } : entry));
    persistSavedTemplates(next);
    setSchemaMessage(`Template renamed to \"${trimmed}\".`);
  };

  const getImportPreview = (): ImportPreview | null => {
    const raw = schemaInput.trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      const normalized = normalizeImportedFormConfig(parsed);
      if (!normalized) {
        return {
          valid: false,
          nextFieldCount: 0,
          nextMappingCount: 0,
          addedFields: [],
          removedFields: [],
          error: 'Invalid schema shape.',
        };
      }

      const currentNames = new Set(formConfig.fields.map((field) => field.name));
      const nextNames = new Set(normalized.fields.map((field) => field.name));

      const addedFields = normalized.fields.map((field) => field.name).filter((name) => !currentNames.has(name));
      const removedFields = formConfig.fields.map((field) => field.name).filter((name) => !nextNames.has(name));

      return {
        valid: true,
        nextFieldCount: normalized.fields.length,
        nextMappingCount: (normalized.responseMappings || []).length,
        addedFields,
        removedFields,
      };
    } catch {
      return {
        valid: false,
        nextFieldCount: 0,
        nextMappingCount: 0,
        addedFields: [],
        removedFields: [],
        error: 'JSON parse error.',
      };
    }
  };

  const handleExportSchema = async () => {
    const serialized = JSON.stringify(formConfig, null, 2);
    try {
      await navigator.clipboard.writeText(serialized);
      setSchemaMessage('Schema copied to clipboard.');
    } catch {
      setSchemaInput(serialized);
      setShowSchemaImport(true);
      setSchemaMessage('Clipboard unavailable. Schema placed in import box.');
    }
  };

  const handleImportSchema = () => {
    const hasExistingConfig = formConfig.fields.length > 0 || Boolean(formConfig.responseMappings?.length);
    if (hasExistingConfig) {
      const confirmed = window.confirm('Import schema will replace current form configuration. Continue?');
      if (!confirmed) {
        setSchemaMessage('Import canceled.');
        return;
      }
    }

    try {
      const parsed = JSON.parse(schemaInput);
      const normalized = normalizeImportedFormConfig(parsed);
      if (!normalized) {
        setSchemaMessage('Invalid schema format.');
        return;
      }

      setUndoSnapshot(cloneFormConfig(formConfig));
      updateActiveRequest({ formConfig: normalized });
      setSchemaMessage('Schema imported successfully.');
      setShowSchemaImport(false);
    } catch {
      setSchemaMessage('Schema JSON parse failed.');
    }
  };

  const handleResetToAutoGenerated = () => {
    const confirmed = window.confirm('Reset current form config to auto-generated schema from request?');
    if (!confirmed) {
      return;
    }

    setUndoSnapshot(cloneFormConfig(formConfig));
    updateActiveRequest({ formConfig: createAutoFormConfigFromRequest(request) });
    setSchemaMessage('Form reset to auto-generated schema.');
  };

  const handleUndoLastReplace = () => {
    if (!undoSnapshot) {
      return;
    }

    updateActiveRequest({ formConfig: undoSnapshot });
    setUndoSnapshot(null);
    setSchemaMessage('Last replace action has been undone.');
  };

  const importPreview = showSchemaImport ? getImportPreview() : null;

  return (
    <div className="flex flex-col h-full overflow-auto p-4">
      <div className="max-w-4xl w-full space-y-5 pb-8">
        <div>
          <label className="block text-xs text-app-muted mb-1">Request Description (Markdown)</label>
          <textarea
            value={request.description || ''}
            onChange={(event) => updateActiveRequest({ description: event.target.value })}
            placeholder="# Endpoint Description

Describe what this endpoint does, its parameters, and expected responses.

## Parameters
- `id` - The user ID

## Response
Returns a JSON object with user data."
            rows={8}
            className="input-field font-mono text-xs resize-none"
          />
        </div>

        <section className="border border-app-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-app-sidebar border-b border-app-border flex flex-wrap items-center gap-2 justify-between">
            <div>
              <p className="text-sm text-app-text font-medium">Request Form Interface</p>
              <p className="text-xs text-app-muted">Auto-generate form from request, then customize with drag and drop mapping.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateFormConfig({ enabled: !formConfig.enabled })}
                className={`text-xs px-3 py-1.5 rounded border ${formConfig.enabled ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-app-border text-app-muted hover:text-app-text hover:bg-app-hover'}`}
              >
                {formConfig.enabled ? 'Form Enabled' : 'Enable Form'}
              </button>
              <button
                onClick={() => updateActiveRequest({ formConfig: createAutoFormConfigFromRequest(request) })}
                className="btn-ghost text-xs inline-flex items-center gap-1.5"
              >
                <Sparkles size={12} /> Auto Generate
              </button>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {!formConfig.enabled && (
              <p className="text-xs text-app-muted">Enable the form to make this endpoint available as a shared public form interface.</p>
            )}

            {formConfig.enabled && (
              <>
                <div className="border border-app-border rounded p-3 space-y-2">
                  <p className="text-xs uppercase tracking-wider text-app-muted">Quick Templates</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => applyTemplate('login')} className="btn-ghost text-xs">+ Login</button>
                    <button onClick={() => applyTemplate('register')} className="btn-ghost text-xs">+ Register</button>
                    <button onClick={() => applyTemplate('address')} className="btn-ghost text-xs">+ Address</button>
                    <button onClick={() => applyTemplate('payment')} className="btn-ghost text-xs">+ Payment</button>
                  </div>
                  <div className="pt-1 border-t border-app-border space-y-2">
                    <p className="text-[11px] text-app-muted">Custom Templates (stored in this request, synced on Save)</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={customTemplateName}
                        onChange={(event) => setCustomTemplateName(event.target.value)}
                        placeholder="Template name"
                        className="input-field text-xs max-w-48"
                      />
                      <button onClick={handleSaveCurrentAsTemplate} className="btn-ghost text-xs">Save Current Fields</button>
                    </div>
                    {savedTemplates.length > 0 && (
                      <div className="space-y-1.5">
                        {savedTemplates.map((template) => (
                          <div key={template.id} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-app-text">{template.name}</span>
                            <span className="text-app-muted">({template.fields.length} fields)</span>
                            <button onClick={() => handleApplySavedTemplate(template.id)} className="btn-ghost text-xs">Apply</button>
                            <button onClick={() => handleRenameSavedTemplate(template.id)} className="btn-ghost text-xs">Rename</button>
                            <button onClick={() => handleDeleteSavedTemplate(template.id)} className="btn-ghost text-xs">Delete</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border border-app-border rounded p-3 space-y-2">
                  <p className="text-xs uppercase tracking-wider text-app-muted">Schema Tools</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={handleExportSchema} className="btn-ghost text-xs inline-flex items-center gap-1">
                      <Download size={12} /> Export Schema
                    </button>
                    <button onClick={() => setShowSchemaImport((prev) => !prev)} className="btn-ghost text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Upload size={12} /> {showSchemaImport ? 'Hide Import' : 'Import Schema'}
                      </span>
                    </button>
                    <button onClick={handleResetToAutoGenerated} className="btn-ghost text-xs inline-flex items-center gap-1">
                      <RotateCcw size={12} /> Reset To Auto
                    </button>
                    <button
                      onClick={handleUndoLastReplace}
                      className="btn-ghost text-xs inline-flex items-center gap-1"
                      disabled={!undoSnapshot}
                      title={!undoSnapshot ? 'No replace action to undo yet' : 'Undo last import or reset'}
                    >
                      <RotateCcw size={12} /> Undo Replace
                    </button>
                  </div>
                  {showSchemaImport && (
                    <div className="space-y-2">
                      <textarea
                        value={schemaInput}
                        onChange={(event) => setSchemaInput(event.target.value)}
                        className="input-field font-mono text-xs min-h-24"
                        placeholder="Paste RequestFormConfig JSON here"
                      />
                      <button onClick={handleImportSchema} className="btn-primary text-xs py-1.5">Apply Imported Schema</button>
                      {importPreview && (
                        <div className="text-[11px] rounded border border-app-border p-2 space-y-1 text-app-muted">
                          {importPreview.valid ? (
                            <>
                              <p>Preview: {importPreview.nextFieldCount} fields, {importPreview.nextMappingCount} mappings.</p>
                              <p>Added fields: {importPreview.addedFields.length || 0} | Removed fields: {importPreview.removedFields.length || 0}</p>
                              {importPreview.addedFields.length > 0 && (
                                <p className="break-words">Added names: {importPreview.addedFields.slice(0, 8).join(', ')}{importPreview.addedFields.length > 8 ? ' ...' : ''}</p>
                              )}
                              {importPreview.removedFields.length > 0 && (
                                <p className="break-words">Removed names: {importPreview.removedFields.slice(0, 8).join(', ')}{importPreview.removedFields.length > 8 ? ' ...' : ''}</p>
                              )}
                            </>
                          ) : (
                            <p>Preview error: {importPreview.error}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {schemaMessage && <p className="text-xs text-app-muted">{schemaMessage}</p>}
                </div>

                {groupOrder.length > 0 && (
                  <div className="border border-app-border rounded p-3 space-y-2">
                    <p className="text-xs uppercase tracking-wider text-app-muted">Group Order (Drag & Drop)</p>
                    <div className="flex flex-wrap gap-2">
                      {groupOrder.map((groupName) => (
                        <div
                          key={groupName}
                          draggable
                          onDragStart={() => setDraggedGroup(groupName)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            if (!draggedGroup) return;
                            moveGroupTo(draggedGroup, groupName);
                            setDraggedGroup(null);
                          }}
                          className="inline-flex items-center gap-1 border border-app-border rounded px-2 py-1 text-xs text-app-text bg-app-bg"
                          title="Drag and drop to reorder this group"
                        >
                          <span>{groupName}</span>
                          <button
                            type="button"
                            title="Move group up"
                            onClick={() => moveGroupBy(groupName, -1)}
                            className="text-app-muted hover:text-app-text"
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            type="button"
                            title="Move group down"
                            onClick={() => moveGroupBy(groupName, 1)}
                            className="text-app-muted hover:text-app-text"
                          >
                            <ArrowDown size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wider text-app-muted">Form Fields</p>
                    <button
                      onClick={() => updateFormConfig({ fields: [...formConfig.fields, createCustomField()] })}
                      className="btn-ghost text-xs inline-flex items-center gap-1"
                    >
                      <Plus size={12} /> Add Custom Field
                    </button>
                  </div>

                  {formConfig.fields.length === 0 && (
                    <div className="text-xs text-app-muted border border-dashed border-app-border rounded p-3">
                      No fields yet. Click Auto Generate or add custom fields.
                    </div>
                  )}

                  {formConfig.fields.map((field) => (
                    <div
                      key={field.id}
                      draggable
                      onDragStart={() => setDraggedFieldId(field.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (!draggedFieldId) {
                          return;
                        }
                        moveField(draggedFieldId, field.id);
                        setDraggedFieldId(null);
                      }}
                      className="border border-app-border rounded p-3 bg-app-bg/60"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="text-xs text-app-muted">
                          Label
                          <input
                            value={field.label}
                            onChange={(event) => updateField(field.id, { label: event.target.value })}
                            className="input-field mt-1 text-xs"
                          />
                        </label>
                        <label className="text-xs text-app-muted">
                          Field Name
                          <input
                            value={field.name}
                            onChange={(event) => updateField(field.id, { name: event.target.value })}
                            className="input-field mt-1 text-xs font-mono"
                          />
                        </label>
                        <label className="text-xs text-app-muted">
                          Type
                          <select
                            value={field.type}
                            onChange={(event) =>
                              updateField(field.id, {
                                type: event.target.value as RequestFormFieldType,
                                options:
                                  event.target.value === 'select' || event.target.value === 'radio'
                                    ? (field.options && field.options.length > 0
                                      ? field.options
                                      : [{ id: createOptionId(), label: 'Option 1', value: 'option_1' }])
                                    : field.options,
                              })
                            }
                            className="input-field mt-1 text-xs bg-app-panel"
                          >
                            {FIELD_TYPES.map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-app-muted">
                          Target Mapping
                          <select
                            value={field.target}
                            onChange={(event) => updateField(field.id, { target: event.target.value as RequestFormFieldTarget })}
                            className="input-field mt-1 text-xs bg-app-panel"
                          >
                            {FIELD_TARGETS.map((target) => (
                              <option key={target} value={target}>{target}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-app-muted">
                          Target Key / Path
                          <input
                            value={field.targetKey}
                            onChange={(event) => updateField(field.id, { targetKey: event.target.value })}
                            className="input-field mt-1 text-xs font-mono"
                            placeholder="username / Authorization / data.profile.id"
                          />
                        </label>
                        <label className="text-xs text-app-muted">
                          Default Value
                          <input
                            value={field.defaultValue || ''}
                            onChange={(event) => updateField(field.id, { defaultValue: event.target.value })}
                            className="input-field mt-1 text-xs"
                          />
                        </label>
                        <label className="text-xs text-app-muted md:col-span-2">
                          Placeholder
                          <input
                            value={field.placeholder || ''}
                            onChange={(event) => updateField(field.id, { placeholder: event.target.value })}
                            className="input-field mt-1 text-xs"
                          />
                        </label>
                        <label className="text-xs text-app-muted md:col-span-2">
                          Description
                          <input
                            value={field.description || ''}
                            onChange={(event) => updateField(field.id, { description: event.target.value })}
                            className="input-field mt-1 text-xs"
                          />
                        </label>
                        <label className="text-xs text-app-muted md:col-span-2">
                          Group / Section
                          <input
                            value={field.group || ''}
                            onChange={(event) => updateField(field.id, { group: event.target.value })}
                            className="input-field mt-1 text-xs"
                            placeholder="Authentication / Billing / Profile"
                          />
                        </label>

                        {(field.type === 'number' || field.type === 'range') && (
                          <>
                            <label className="text-xs text-app-muted">
                              Min
                              <input
                                type="number"
                                value={field.min ?? ''}
                                onChange={(event) => updateField(field.id, { min: event.target.value === '' ? undefined : Number(event.target.value) })}
                                className="input-field mt-1 text-xs"
                              />
                            </label>
                            <label className="text-xs text-app-muted">
                              Max
                              <input
                                type="number"
                                value={field.max ?? ''}
                                onChange={(event) => updateField(field.id, { max: event.target.value === '' ? undefined : Number(event.target.value) })}
                                className="input-field mt-1 text-xs"
                              />
                            </label>
                            <label className="text-xs text-app-muted">
                              Step
                              <input
                                type="number"
                                value={field.step ?? ''}
                                onChange={(event) => updateField(field.id, { step: event.target.value === '' ? undefined : Number(event.target.value) })}
                                className="input-field mt-1 text-xs"
                              />
                            </label>
                          </>
                        )}

                        {(field.type === 'text' || field.type === 'email' || field.type === 'tel' || field.type === 'url' || field.type === 'password') && (
                          <label className="text-xs text-app-muted">
                            Pattern (Regex)
                            <input
                              value={field.pattern || ''}
                              onChange={(event) => updateField(field.id, { pattern: event.target.value })}
                              className="input-field mt-1 text-xs font-mono"
                              placeholder="^[a-zA-Z0-9_]+$"
                            />
                          </label>
                        )}

                        {field.type === 'file' && (
                          <>
                            <label className="text-xs text-app-muted">
                              Accept
                              <input
                                value={field.accept || ''}
                                onChange={(event) => updateField(field.id, { accept: event.target.value })}
                                className="input-field mt-1 text-xs"
                                placeholder="image/*,.pdf"
                              />
                            </label>
                            <label className="text-xs text-app-muted inline-flex items-center gap-2 mt-6">
                              <input
                                type="checkbox"
                                checked={Boolean(field.multiple)}
                                onChange={(event) => updateField(field.id, { multiple: event.target.checked })}
                                className="w-3.5 h-3.5 accent-orange-500"
                              />
                              Allow multiple files
                            </label>
                          </>
                        )}

                        {(field.type === 'select' || field.type === 'radio') && (
                          <div className="md:col-span-2 border border-app-border rounded p-2">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs text-app-muted">Options</p>
                              <button
                                onClick={() => addFieldOption(field.id)}
                                className="btn-ghost text-xs inline-flex items-center gap-1"
                              >
                                <Plus size={11} /> Add Option
                              </button>
                            </div>
                            <div className="space-y-2">
                              {(field.options || []).map((option) => (
                                <div key={option.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                                  <input
                                    value={option.label}
                                    onChange={(event) => updateFieldOption(field.id, option.id, { label: event.target.value })}
                                    className="input-field text-xs"
                                    placeholder="Label"
                                  />
                                  <input
                                    value={option.value}
                                    onChange={(event) => updateFieldOption(field.id, option.id, { value: event.target.value })}
                                    className="input-field text-xs font-mono"
                                    placeholder="value"
                                  />
                                  <button
                                    onClick={() => removeFieldOption(field.id, option.id)}
                                    className="btn-ghost text-xs inline-flex items-center gap-1 justify-center"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {field.type === 'address' && (
                          <p className="md:col-span-2 text-[11px] text-app-muted">
                            Address field stores JSON object with: street, city, state, postalCode, country.
                          </p>
                        )}

                        {field.type === 'json' && (
                          <p className="md:col-span-2 text-[11px] text-app-muted">
                            JSON field expects valid JSON text and supports mapping into nested object path.
                          </p>
                        )}

                        <div className="md:col-span-2 border border-app-border rounded p-2 space-y-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <label className="text-xs text-app-muted inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={Boolean(field.repeatable)}
                                onChange={(event) => updateField(field.id, { repeatable: event.target.checked })}
                                className="w-3.5 h-3.5 accent-orange-500"
                              />
                              Repeatable (array)
                            </label>
                            {field.repeatable && (
                              <label className="text-xs text-app-muted">
                                Item Separator
                                <select
                                  value={field.repeatSeparator || 'newline'}
                                  onChange={(event) => updateField(field.id, { repeatSeparator: event.target.value as 'newline' | 'comma' | 'json-lines' })}
                                  className="input-field mt-1 text-xs bg-app-panel"
                                >
                                  <option value="newline">New line</option>
                                  <option value="comma">Comma</option>
                                  <option value="json-lines">JSON lines</option>
                                </select>
                              </label>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <label className="text-xs text-app-muted">
                              Visibility Depends On
                              <select
                                value={field.visibilityDependsOnFieldName || ''}
                                onChange={(event) => updateField(field.id, { visibilityDependsOnFieldName: event.target.value })}
                                className="input-field mt-1 text-xs bg-app-panel"
                              >
                                <option value="">Always visible</option>
                                {formConfig.fields
                                  .filter((candidate) => candidate.id !== field.id)
                                  .map((candidate) => (
                                    <option key={candidate.id} value={candidate.name}>{candidate.label || candidate.name}</option>
                                  ))}
                              </select>
                            </label>

                            {(field.visibilityDependsOnFieldName || '').trim() && (
                              <>
                                <label className="text-xs text-app-muted">
                                  Operator
                                  <select
                                    value={field.visibilityOperator || 'equals'}
                                    onChange={(event) =>
                                      updateField(field.id, {
                                        visibilityOperator: event.target.value as RequestFormField['visibilityOperator'],
                                      })
                                    }
                                    className="input-field mt-1 text-xs bg-app-panel"
                                  >
                                    <option value="equals">equals</option>
                                    <option value="not-equals">not-equals</option>
                                    <option value="contains">contains</option>
                                    <option value="filled">filled</option>
                                    <option value="not-filled">not-filled</option>
                                  </select>
                                </label>
                                {field.visibilityOperator !== 'filled' && field.visibilityOperator !== 'not-filled' && (
                                  <label className="text-xs text-app-muted">
                                    Compare Value
                                    <input
                                      value={field.visibilityValue || ''}
                                      onChange={(event) => updateField(field.id, { visibilityValue: event.target.value })}
                                      className="input-field mt-1 text-xs"
                                    />
                                  </label>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <label className="text-xs text-app-muted inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={Boolean(field.required)}
                            onChange={(event) => updateField(field.id, { required: event.target.checked })}
                            className="w-3.5 h-3.5 accent-orange-500"
                          />
                          Required field
                        </label>
                        <button onClick={() => removeField(field.id)} className="btn-ghost text-xs inline-flex items-center gap-1">
                          <Trash2 size={11} /> Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-app-border pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wider text-app-muted">Auth Dependency</p>
                    <label className="text-xs text-app-muted inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(formConfig.authRequirement?.enabled)}
                        onChange={(event) =>
                          updateFormConfig({
                            authRequirement: {
                              ...(formConfig.authRequirement || createDefaultFormConfig().authRequirement!),
                              enabled: event.target.checked,
                            },
                          })
                        }
                        className="w-3.5 h-3.5 accent-orange-500"
                      />
                      Require auth from another request
                    </label>
                  </div>

                  {formConfig.authRequirement?.enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <label className="text-xs text-app-muted">
                        Source Request
                        <select
                          value={formConfig.authRequirement.sourceRequestId || ''}
                          onChange={(event) =>
                            updateFormConfig({
                              authRequirement: {
                                ...formConfig.authRequirement,
                                enabled: true,
                                sourceRequestId: event.target.value,
                              },
                            })
                          }
                          className="input-field mt-1 text-xs bg-app-panel"
                        >
                          <option value="">Select request...</option>
                          {availableAuthRequests.map((entry) => (
                            <option key={entry.id} value={entry.id}>{entry.name}</option>
                          ))}
                        </select>
                      </label>

                      <label className="text-xs text-app-muted">
                        Token Path in JSON response
                        <input
                          value={formConfig.authRequirement.tokenPath || ''}
                          onChange={(event) =>
                            updateFormConfig({
                              authRequirement: {
                                ...formConfig.authRequirement,
                                enabled: true,
                                tokenPath: event.target.value,
                              },
                            })
                          }
                          className="input-field mt-1 text-xs font-mono"
                          placeholder="token or data.access_token"
                        />
                      </label>

                      <label className="text-xs text-app-muted">
                        Header Name
                        <input
                          value={formConfig.authRequirement.headerName || 'Authorization'}
                          onChange={(event) =>
                            updateFormConfig({
                              authRequirement: {
                                ...formConfig.authRequirement,
                                enabled: true,
                                headerName: event.target.value,
                              },
                            })
                          }
                          className="input-field mt-1 text-xs font-mono"
                        />
                      </label>

                      <label className="text-xs text-app-muted">
                        Header Scheme
                        <select
                          value={formConfig.authRequirement.scheme || 'Bearer'}
                          onChange={(event) =>
                            updateFormConfig({
                              authRequirement: {
                                ...formConfig.authRequirement,
                                enabled: true,
                                scheme: event.target.value as 'Bearer' | 'Token' | 'Raw',
                              },
                            })
                          }
                          className="input-field mt-1 text-xs bg-app-panel"
                        >
                          <option value="Bearer">Bearer</option>
                          <option value="Token">Token</option>
                          <option value="Raw">Raw token</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>

                <div className="border-t border-app-border pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wider text-app-muted">Response To Form Mapping</p>
                    <button
                      onClick={() => {
                        const firstField = formConfig.fields[0];
                        const firstRequest = availableAuthRequests[0];
                        if (!firstField || !firstRequest) {
                          return;
                        }
                        updateFormConfig({
                          responseMappings: [
                            ...(formConfig.responseMappings || []),
                            {
                              id: createMappingId(),
                              sourceRequestId: firstRequest.id,
                              responsePath: 'token',
                              targetFieldId: firstField.id,
                            },
                          ],
                        });
                      }}
                      className="btn-ghost text-xs inline-flex items-center gap-1"
                    >
                      <Plus size={12} /> Add Mapping
                    </button>
                  </div>

                  {(formConfig.responseMappings || []).map((mapping) => (
                    <div key={mapping.id} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end border border-app-border rounded p-3">
                      <label className="text-xs text-app-muted">
                        Source Request
                        <select
                          value={mapping.sourceRequestId}
                          onChange={(event) =>
                            updateFormConfig({
                              responseMappings: (formConfig.responseMappings || []).map((entry) =>
                                entry.id === mapping.id ? { ...entry, sourceRequestId: event.target.value } : entry,
                              ),
                            })
                          }
                          className="input-field mt-1 text-xs bg-app-panel"
                        >
                          <option value="">Select request...</option>
                          {availableAuthRequests.map((entry) => (
                            <option key={entry.id} value={entry.id}>{entry.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-app-muted">
                        Response Path
                        <input
                          value={mapping.responsePath}
                          onChange={(event) =>
                            updateFormConfig({
                              responseMappings: (formConfig.responseMappings || []).map((entry) =>
                                entry.id === mapping.id ? { ...entry, responsePath: event.target.value } : entry,
                              ),
                            })
                          }
                          className="input-field mt-1 text-xs font-mono"
                          placeholder="data.user.id"
                        />
                      </label>
                      <label className="text-xs text-app-muted">
                        Target Field
                        <select
                          value={mapping.targetFieldId}
                          onChange={(event) =>
                            updateFormConfig({
                              responseMappings: (formConfig.responseMappings || []).map((entry) =>
                                entry.id === mapping.id ? { ...entry, targetFieldId: event.target.value } : entry,
                              ),
                            })
                          }
                          className="input-field mt-1 text-xs bg-app-panel"
                        >
                          {formConfig.fields.map((field) => (
                            <option key={field.id} value={field.id}>{field.label || field.name}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        onClick={() =>
                          updateFormConfig({
                            responseMappings: (formConfig.responseMappings || []).filter((entry) => entry.id !== mapping.id),
                          })
                        }
                        className="btn-ghost text-xs inline-flex items-center gap-1 justify-center"
                      >
                        <Trash2 size={11} /> Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="border-t border-app-border pt-4 space-y-3">
                  <p className="text-xs uppercase tracking-wider text-app-muted">Form Scripts</p>
                  <label className="text-xs text-app-muted block">
                    Before Submit Script (JS, receives <code>context</code>)
                    <textarea
                      value={formConfig.scripts?.beforeSubmit || ''}
                      onChange={(event) =>
                        updateFormConfig({
                          scripts: {
                            ...(formConfig.scripts || {}),
                            beforeSubmit: event.target.value,
                          },
                        })
                      }
                      className="input-field mt-1 font-mono text-xs min-h-20"
                      placeholder="context.values.username = context.values.username?.trim();\nreturn context.values;"
                    />
                  </label>

                  <label className="text-xs text-app-muted block">
                    After Response Script (JS, receives <code>context</code>)
                    <textarea
                      value={formConfig.scripts?.afterResponse || ''}
                      onChange={(event) =>
                        updateFormConfig({
                          scripts: {
                            ...(formConfig.scripts || {}),
                            afterResponse: event.target.value,
                          },
                        })
                      }
                      className="input-field mt-1 font-mono text-xs min-h-20"
                      placeholder="if (context.response.status === 200) { return { message: 'ok' }; }"
                    />
                  </label>
                </div>
              </>
            )}
          </div>
        </section>

        <p className="text-xs text-app-muted">
          Form configuration is part of this request. Click Save (or press Ctrl+S) to persist it to your collection/backend.
        </p>
      </div>
    </div>
  );
}
