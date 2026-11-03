import { configurationStatus, readServerConfiguration } from './config.mjs';

// No network requests, key printing, model value printing, or secret persistence.
console.log(JSON.stringify(configurationStatus(readServerConfiguration()), null, 2));
