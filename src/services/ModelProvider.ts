import fetch, { Response } from 'node-fetch';
import {
    IModelProvider,
    IConfigurationManager,
    ModelInfo,
    ChatCompletionRequest,
    ChatCompletionChunk,
    ModelError,
    Result
} from '../types';
import { getLogger } from '../utils/logger';

export class LLMModelProvider implements IModelProvider {
    private static readonly REQUEST_TIMEOUT = 30000;
    private readonly logger = getLogger();

    constructor(private readonly configManager: IConfigurationManager) {}

    private validateUrl(urlString: string): void {
        let url: URL;
        try {
            url = new URL(urlString);
        } catch (error) {
            throw new ModelError(`Invalid URL: ${urlString}`, 'INVALID_URL');
        }

        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new ModelError(`Unsupported URL scheme: ${url.protocol}`, 'INVALID_URL_SCHEME');
        }
    }


    async getModels(): Promise<ReadonlyArray<ModelInfo>> {
        const config = this.configManager.getConfiguration();
        const baseUrl = config.providerUrl.endsWith('/') ? config.providerUrl.slice(0, -1) : config.providerUrl;
        const url = `${baseUrl}/v1/models`;
        this.validateUrl(url);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), LLMModelProvider.REQUEST_TIMEOUT);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: this.createHeaders(),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new ModelError(
                    `Failed to fetch models: ${response.status} ${response.statusText}`
                );
            }

            const data = await response.json() as { data: ModelInfo[] };
            const models = data.data || [];
            this.logger.debug(`Retrieved ${models.length} models from provider`);
            return models;
        } catch (error) {
            this.logger.warn('Failed to fetch models from provider, returning empty array', error);
            return [];
        }
    }
    
    async isModelLoaded(modelId: string): Promise<boolean> {
        if (!modelId.trim()) {
            return false;
        }

        try {
            const models = await this.getModels();
            const isLoaded = models.some(model => model.id === modelId);
            this.logger.debug(`Model "${modelId}" loaded status: ${isLoaded}`);
            return isLoaded;
        } catch (error) {
            this.logger.error(`Failed to check if model "${modelId}" is loaded`, error);
            return false;
        }
    }

    async createChatCompletion(request: ChatCompletionRequest): Promise<AsyncIterableIterator<ChatCompletionChunk>> {
        this.validateChatCompletionRequest(request);

        const config = this.configManager.getConfiguration();
        const baseUrl = config.providerUrl.endsWith('/') ? config.providerUrl.slice(0, -1) : config.providerUrl;
        const url = `${baseUrl}/v1/chat/completions`;
        this.validateUrl(url);

        const requestBody = this.buildChatCompletionBody(request);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), LLMModelProvider.REQUEST_TIMEOUT);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...this.createHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new ModelError(
                `Chat completion request failed: ${response.status} ${response.statusText}`
            );
        }

        this.logger.debug('Starting chat completion stream', {
            model: request.model,
            messageCount: request.messages.length
        });

        return this.parseStreamingResponse(response);
    }

    private createHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json'
        };
    }

    private buildChatCompletionBody(request: ChatCompletionRequest): Record<string, unknown> {
        return {
            model: request.model,
            messages: request.messages,
            temperature: request.temperature ?? 0.7,
            stream: request.stream ?? true,
            max_tokens: request.max_tokens,
            top_p: request.top_p,
            frequency_penalty: request.frequency_penalty,
            presence_penalty: request.presence_penalty
        };
    }

    private validateChatCompletionRequest(request: ChatCompletionRequest): void {
        if (!request.model?.trim()) {
            throw new ModelError('Model is required for chat completion');
        }

        if (!Array.isArray(request.messages) || request.messages.length === 0) {
            throw new ModelError('Messages array is required and cannot be empty');
        }

        for (const message of request.messages) {
            if (!message.role || !message.content?.trim()) {
                throw new ModelError('Each message must have a role and content');
            }
        }

        if (request.temperature !== undefined && (request.temperature < 0 || request.temperature > 2)) {
            throw new ModelError('Temperature must be between 0 and 2');
        }
    }

    private async* parseStreamingResponse(response: Response): AsyncIterableIterator<ChatCompletionChunk> {
        if (!response.body) {
            throw new ModelError('No response body received from AI provider');
        }

        const reader = response.body;
        let buffer = '';
        let finished = false;

        // Set up event handlers
        reader.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
        });

        reader.on('end', () => {
            finished = true;
        });

        reader.on('error', (error: Error) => {
            this.logger.error('Streaming response error', error);
            throw new ModelError('Stream reading error', error);
        });

        try {
            while (!finished || buffer.length > 0) {
                await this.waitForData(buffer, finished);

                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

                for (const line of lines) {
                    const chunk = this.parseStreamLine(line);
                    if (chunk) {
                        if (this.isDoneChunk(chunk)) {
                            this.logger.debug('Received stream completion signal');
                            return;
                        }
                        yield chunk;
                    }
                }

                if (finished && buffer.length === 0) {
                    break;
                }
            }
        } catch (error) {
            this.logger.error('Error in streaming response parser', error);
            throw error instanceof ModelError ? error : new ModelError('Stream parsing error', error);
        }

        this.logger.debug('Streaming response completed');
    }

    private async waitForData(buffer: string, finished: boolean): Promise<void> {
        if (buffer.includes('\n') || finished) {
            return;
        }

        return new Promise(resolve => {
            setTimeout(resolve, 10);
        });
    }

    private parseStreamLine(line: string): ChatCompletionChunk | null {
        const trimmedLine = line.trim();
        
        if (trimmedLine === '' || trimmedLine === 'data: [DONE]') {
            return null;
        }
        
        if (!trimmedLine.startsWith('data: ')) {
            return null;
        }

        const jsonStr = trimmedLine.substring(6);
        
        try {
            const chunk = JSON.parse(jsonStr) as ChatCompletionChunk;
            
            if ('error' in chunk) {
                throw new ModelError((chunk as any).error.message);
            }
            
            return chunk;
        } catch (error) {
            if (error instanceof SyntaxError) {
                this.logger.debug('Skipping malformed JSON chunk', jsonStr);
                return null;
            }
            throw error;
        }
    }

    private isDoneChunk(chunk: ChatCompletionChunk): boolean {
        return chunk.choices?.some(choice => choice.finish_reason !== null) ?? false;
    }
}