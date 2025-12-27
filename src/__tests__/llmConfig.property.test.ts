/**
 * Property-Based Tests for LLM Configuration Module
 * 
 * **Feature: multi-provider-llm**
 * 
 * **Property 1: Valid Provider Selection**
 * *For any* valid provider value ('openai', 'anthropic', 'google'), when `LLM_PROVIDER` is set 
 * to that value and the corresponding API key is present, `getLLMConfig()` SHALL return a config 
 * with that provider.
 * **Validates: Requirements 1.1, 1.2, 1.3**
 * 
 * **Property 2: Invalid Provider Returns Null**
 * *For any* string that is not a valid provider value ('openai', 'anthropic', 'google'), 
 * when `LLM_PROVIDER` is set to that string, `getLLMConfig()` SHALL return null.
 * **Validates: Requirements 1.5**
 * 
 * **Property 3: Correct API Key Selection**
 * *For any* provider, `getLLMConfig()` SHALL read the API key from the provider-specific 
 * environment variable.
 * **Validates: Requirements 2.1, 2.2, 2.3**
 * 
 * **Property 4: Missing API Key Returns Null**
 * *For any* provider, if the corresponding API key environment variable is not set, 
 * `getLLMConfig()` SHALL return null.
 * **Validates: Requirements 2.4**
 * 
 * **Property 5: Custom Model Selection**
 * *For any* provider, when the provider-specific model environment variable is set, 
 * `getLLMConfig()` SHALL return a config with that model value.
 * **Validates: Requirements 3.1, 3.3, 3.5**
 * 
 * **Property 6: Default Model Fallback**
 * *For any* provider, when the provider-specific model environment variable is not set, 
 * `getLLMConfig()` SHALL return a config with the default model for that provider.
 * **Validates: Requirements 3.2, 3.4, 3.6**
 * 
 * **Property 7: Base URL Configuration**
 * *For any* provider configuration, when the provider-specific BASE_URL is set, `getLLMConfig()` SHALL 
 * return a config with that baseUrl value.
 * **Validates: Requirements 4.1, 4.2**
 * 
 * **Property 8: Backward Compatibility**
 * *For any* environment where only `OPENAI_API_KEY` is set (without `LLM_PROVIDER`), 
 * `getLLMConfig()` SHALL return a config with provider 'openai'.
 * **Validates: Requirements 8.1, 8.2**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { 
  getLLMConfig, 
  validateProvider, 
  PROVIDER_DEFAULTS, 
  PROVIDER_ENV_KEYS,
  createLLMClient,
  createProviderModel,
  type LLMProvider,
  type LLMConfig
} from '../llmConfig.js';

const TEST_TIMEOUT = 30000;

// Valid providers for testing
const VALID_PROVIDERS: LLMProvider[] = ['openai', 'anthropic', 'google'];

// Helper to save and restore environment variables
function withEnv(envVars: Record<string, string | undefined>, fn: () => void) {
  const originalEnv: Record<string, string | undefined> = {};
  
  // Save original values and clear all LLM-related env vars
  const allEnvKeys = [
    'LLM_PROVIDER', 'LLM_MODEL', 'LLM_BASE_URL',
    'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL',
    'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL',
    'GOOGLE_API_KEY', 'GOOGLE_MODEL', 'GOOGLE_BASE_URL'
  ];
  
  for (const key of allEnvKeys) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  
  // Set new values
  for (const [key, value] of Object.entries(envVars)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
  
  try {
    fn();
  } finally {
    // Restore original values
    for (const key of allEnvKeys) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  }
}

describe('LLM Config Property Tests', () => {
  /**
   * Feature: multi-provider-llm, Property 1: Valid Provider Selection
   * **Validates: Requirements 1.1, 1.2, 1.3**
   */
  describe('Property 1: Valid Provider Selection', () => {
    it('should return config with correct provider when valid provider is set', () => {
      const providerArb = fc.constantFrom(...VALID_PROVIDERS);
      const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 });

      fc.assert(
        fc.property(providerArb, apiKeyArb, (provider, apiKey) => {
          const envKey = PROVIDER_ENV_KEYS[provider].apiKey;
          
          withEnv({ LLM_PROVIDER: provider, [envKey]: apiKey }, () => {
            const config = getLLMConfig();
            expect(config).not.toBeNull();
            expect(config!.provider).toBe(provider);
          });

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });

  /**
   * Feature: multi-provider-llm, Property 2: Invalid Provider Returns Null
   * **Validates: Requirements 1.5**
   */
  describe('Property 2: Invalid Provider Returns Null', () => {
    it('should return null for invalid provider strings', () => {
      // Generate strings that are NOT valid providers
      const invalidProviderArb = fc.string({ minLength: 1, maxLength: 20 })
        .filter(s => !VALID_PROVIDERS.includes(s.toLowerCase() as LLMProvider));

      fc.assert(
        fc.property(invalidProviderArb, (invalidProvider) => {
          withEnv({ 
            LLM_PROVIDER: invalidProvider, 
            OPENAI_API_KEY: 'test-key' 
          }, () => {
            const config = getLLMConfig();
            expect(config).toBeNull();
          });

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);

    it('validateProvider should return null for invalid values', () => {
      const invalidProviderArb = fc.string({ minLength: 1, maxLength: 20 })
        .filter(s => !VALID_PROVIDERS.includes(s as LLMProvider));

      fc.assert(
        fc.property(invalidProviderArb, (invalidProvider) => {
          const result = validateProvider(invalidProvider);
          expect(result).toBeNull();
          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });

  /**
   * Feature: multi-provider-llm, Property 3: Correct API Key Selection
   * **Validates: Requirements 2.1, 2.2, 2.3**
   */
  describe('Property 3: Correct API Key Selection', () => {
    it('should read API key from provider-specific environment variable', () => {
      const providerArb = fc.constantFrom(...VALID_PROVIDERS);
      const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 });

      fc.assert(
        fc.property(providerArb, apiKeyArb, (provider, apiKey) => {
          const envKey = PROVIDER_ENV_KEYS[provider].apiKey;
          
          withEnv({ LLM_PROVIDER: provider, [envKey]: apiKey }, () => {
            const config = getLLMConfig();
            expect(config).not.toBeNull();
            expect(config!.apiKey).toBe(apiKey);
          });

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });

  /**
   * Feature: multi-provider-llm, Property 4: Missing API Key Returns Null
   * **Validates: Requirements 2.4**
   */
  describe('Property 4: Missing API Key Returns Null', () => {
    it('should return null when API key is missing for any provider', () => {
      const providerArb = fc.constantFrom(...VALID_PROVIDERS);

      fc.assert(
        fc.property(providerArb, (provider) => {
          // Set provider but NOT the API key
          withEnv({ LLM_PROVIDER: provider }, () => {
            const config = getLLMConfig();
            expect(config).toBeNull();
          });

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });

  /**
   * Feature: multi-provider-llm, Property 5: Custom Model Selection
   * **Validates: Requirements 3.1, 3.3, 3.5**
   */
  describe('Property 5: Custom Model Selection', () => {
    it('should use custom model when provider-specific model env var is set', () => {
      const providerArb = fc.constantFrom(...VALID_PROVIDERS);
      const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 });
      const customModelArb = fc.string({ minLength: 5, maxLength: 30 });

      fc.assert(
        fc.property(providerArb, apiKeyArb, customModelArb, (provider, apiKey, customModel) => {
          const envKeys = PROVIDER_ENV_KEYS[provider];
          
          withEnv({ 
            LLM_PROVIDER: provider, 
            [envKeys.apiKey]: apiKey,
            [envKeys.model]: customModel
          }, () => {
            const config = getLLMConfig();
            expect(config).not.toBeNull();
            expect(config!.model).toBe(customModel);
          });

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });

  /**
   * Feature: multi-provider-llm, Property 6: Default Model Fallback
   * **Validates: Requirements 3.2, 3.4, 3.6**
   */
  describe('Property 6: Default Model Fallback', () => {
    it('should use default model when provider-specific model env var is not set', () => {
      const providerArb = fc.constantFrom(...VALID_PROVIDERS);
      const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 });

      fc.assert(
        fc.property(providerArb, apiKeyArb, (provider, apiKey) => {
          const envKey = PROVIDER_ENV_KEYS[provider].apiKey;
          const expectedModel = PROVIDER_DEFAULTS[provider].model;
          
          withEnv({ LLM_PROVIDER: provider, [envKey]: apiKey }, () => {
            const config = getLLMConfig();
            expect(config).not.toBeNull();
            expect(config!.model).toBe(expectedModel);
          });

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });

  /**
   * Feature: multi-provider-llm, Property 7: Base URL Configuration
   * **Validates: Requirements 4.1, 4.2**
   */
  describe('Property 7: Base URL Configuration', () => {
    it('should include baseUrl when provider-specific BASE_URL is set', () => {
      const providerArb = fc.constantFrom(...VALID_PROVIDERS);
      const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 });
      const baseUrlArb = fc.webUrl();

      fc.assert(
        fc.property(providerArb, apiKeyArb, baseUrlArb, (provider, apiKey, baseUrl) => {
          const envKeys = PROVIDER_ENV_KEYS[provider];
          
          withEnv({ 
            LLM_PROVIDER: provider, 
            [envKeys.apiKey]: apiKey,
            [envKeys.baseUrl]: baseUrl
          }, () => {
            const config = getLLMConfig();
            expect(config).not.toBeNull();
            expect(config!.baseUrl).toBe(baseUrl);
          });

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);

    it('should have undefined baseUrl when provider-specific BASE_URL is not set', () => {
      const providerArb = fc.constantFrom(...VALID_PROVIDERS);
      const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 });

      fc.assert(
        fc.property(providerArb, apiKeyArb, (provider, apiKey) => {
          const envKeys = PROVIDER_ENV_KEYS[provider];
          
          withEnv({ 
            LLM_PROVIDER: provider, 
            [envKeys.apiKey]: apiKey
          }, () => {
            const config = getLLMConfig();
            expect(config).not.toBeNull();
            expect(config!.baseUrl).toBeUndefined();
          });

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });

  /**
   * Feature: multi-provider-llm, Property 8: Backward Compatibility
   * **Validates: Requirements 8.1, 8.2**
   */
  describe('Property 8: Backward Compatibility', () => {
    it('should default to openai when LLM_PROVIDER is not set but OPENAI_API_KEY is', () => {
      const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 });

      fc.assert(
        fc.property(apiKeyArb, (apiKey) => {
          withEnv({ OPENAI_API_KEY: apiKey }, () => {
            const config = getLLMConfig();
            expect(config).not.toBeNull();
            expect(config!.provider).toBe('openai');
            expect(config!.apiKey).toBe(apiKey);
          });

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);

    it('should use OPENAI_MODEL and OPENAI_BASE_URL when LLM_PROVIDER is not set', () => {
      const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 });
      const modelArb = fc.string({ minLength: 5, maxLength: 30 });
      const baseUrlArb = fc.webUrl();

      fc.assert(
        fc.property(apiKeyArb, modelArb, baseUrlArb, (apiKey, model, baseUrl) => {
          withEnv({ 
            OPENAI_API_KEY: apiKey,
            OPENAI_MODEL: model,
            OPENAI_BASE_URL: baseUrl
          }, () => {
            const config = getLLMConfig();
            expect(config).not.toBeNull();
            expect(config!.provider).toBe('openai');
            expect(config!.model).toBe(model);
            expect(config!.baseUrl).toBe(baseUrl);
          });

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });

  /**
   * Feature: multi-provider-llm, Property 9: Client Creation Success
   * *For any* valid LLMConfig, `createLLMClient()` SHALL return an LLMClient instance 
   * with an `analyzeJSVMP` method.
   * **Validates: Requirements 5.1, 5.2**
   */
  describe('Property 9: Client Creation Success', () => {
    it('should return an LLMClient with analyzeJSVMP method for any valid config', () => {
      const providerArb = fc.constantFrom(...VALID_PROVIDERS);
      const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 });
      const modelArb = fc.string({ minLength: 5, maxLength: 30 });
      const baseUrlArb = fc.option(fc.webUrl(), { nil: undefined });

      fc.assert(
        fc.property(providerArb, apiKeyArb, modelArb, baseUrlArb, (provider, apiKey, model, baseUrl) => {
          const config: LLMConfig = {
            provider,
            apiKey,
            model,
            baseUrl: provider === 'openai' ? baseUrl : undefined
          };

          const client = createLLMClient(config);
          
          // Verify client is returned
          expect(client).toBeDefined();
          expect(client).not.toBeNull();
          
          // Verify analyzeJSVMP method exists and is a function
          expect(client.analyzeJSVMP).toBeDefined();
          expect(typeof client.analyzeJSVMP).toBe('function');

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);

    it('should create provider model for any valid config', () => {
      const providerArb = fc.constantFrom(...VALID_PROVIDERS);
      const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 });
      const modelArb = fc.string({ minLength: 5, maxLength: 30 });
      const baseUrlArb = fc.option(fc.webUrl(), { nil: undefined });

      fc.assert(
        fc.property(providerArb, apiKeyArb, modelArb, baseUrlArb, (provider, apiKey, model, baseUrl) => {
          const config: LLMConfig = {
            provider,
            apiKey,
            model,
            baseUrl: provider === 'openai' ? baseUrl : undefined
          };

          const providerModel = createProviderModel(config);
          
          // Verify model is returned
          expect(providerModel).toBeDefined();
          expect(providerModel).not.toBeNull();

          return true;
        }),
        { numRuns: 100 }
      );
    }, TEST_TIMEOUT);
  });
});
