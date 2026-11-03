/** Server-only configuration. This module must never be imported by src/. */
export function readServerConfiguration(environment = process.env) {
  const apiKey = environment.OPENAI_API_KEY?.trim() || '';
  const model = environment.OPENAI_MODEL?.trim() || '';
  return Object.freeze({
    apiKey,
    model,
    requestsEnabled: environment.FOLIO_AI_REQUESTS_ENABLED === 'true',
  });
}

/** Safe diagnostic: intentionally excludes secrets and user-provided values. */
export function configurationStatus(configuration) {
  return Object.freeze({
    keyConfigured: configuration.apiKey.length > 0,
    modelConfigured: configuration.model.length > 0,
    supportedModel: configuration.model === 'gpt-6.1-sol',
    paidRequestsEnabled: configuration.requestsEnabled,
    integration: 'configuration-check-only',
    accountModelVerified: false,
  });
}
