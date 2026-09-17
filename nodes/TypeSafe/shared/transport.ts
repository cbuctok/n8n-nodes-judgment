import type { IDataObject } from 'n8n-workflow';

import { TYPESAFE_API_BASE_URL } from './types';
import type { EntryType, Question } from './types';

export interface QuestionUsage extends IDataObject {
	input_tokens: number;
	output_tokens: number;
}

export interface QuestionAnswers {
	answers: Record<string, unknown>;
	usage?: QuestionUsage;
	model?: string;
	requestId?: string;
	status?: number;
	/** The response body as received, before the node reshapes it for n8n. */
	raw: IDataObject;
}

export interface QuestionRequest {
	state: EntryType;
	questions: Record<string, Question>;
	model?: string;
}

/**
 * The part of n8n's execute context this node needs.
 *
 * It is the whole context rather than `context.helpers` on purpose: n8n's
 * `httpRequestWithAuthentication` internally calls `this.getNode()`, so it must be invoked with
 * the context as its receiver. Calling it with `helpers` as `this` fails at runtime with
 * "this.getNode is not a function".
 */
export interface ExecuteContextBridge {
	helpers: {
		httpRequestWithAuthentication(
			this: unknown,
			credentialsType: string,
			requestOptions: IHttpRequestOptions,
		): Promise<unknown>;
	};
}

export interface IHttpRequestOptions {
	method: 'POST';
	url: string;
	headers: Record<string, string>;
	body: IDataObject;
	json: boolean;
	returnFullResponse: boolean;
}

export interface TransportContext {
	/**
	 * The n8n execute context itself, not its `helpers` bag. `httpRequestWithAuthentication`
	 * reaches back into the context for `getNode()`, so it has to be the receiver of the call.
	 */
	executeContext: ExecuteContextBridge;
	credentialType?: string;
	/** API root from the credential, so a proxy or self-hosted endpoint is honoured. */
	baseUrl?: string;
}

export type Transport = (request: QuestionRequest) => Promise<QuestionAnswers>;

/** API root used when the credential does not override it. */
const DEFAULT_BASE_URL = TYPESAFE_API_BASE_URL;

interface FullHttpResponse {
	body: unknown;
	headers: Record<string, unknown>;
	statusCode: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readHeader(headers: Record<string, unknown>, key: string): string | undefined {
	const value = headers[key] ?? headers[key.toLowerCase()];
	return typeof value === 'string' ? value : undefined;
}

/**
 * Calls `POST /v1/systemone` through n8n's authenticated HTTP helper.
 *
 * The request goes through `httpRequestWithAuthentication` rather than a TypeSafe SDK client on
 * purpose: the SDK resolves its API key from the process environment or a constructor argument,
 * and neither fits how n8n stores credentials. The helper also brings n8n's proxy support, pinned
 * node options, and timeout behaviour along for free.
 */
export function createTransport(context: TransportContext): Transport {
	const credentialType = context.credentialType ?? 'typeSafeApi';
	const baseUrl = (context.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

	return async (request: QuestionRequest): Promise<QuestionAnswers> => {
		const body: IDataObject = {
			state: request.state as IDataObject,
			questions: request.questions as IDataObject,
		};
		if (request.model) {
			body.model = request.model;
		}

		const response = (await context.executeContext.helpers.httpRequestWithAuthentication.call(
			context.executeContext,
			credentialType,
			{
				method: 'POST',
				// An absolute URL, not a path. The credential supplies an Authorization header and
				// no baseURL, so a relative URL would have nothing to resolve against.
				url: `${baseUrl}/v1/systemone`,
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				body,
				json: true,
				returnFullResponse: true,
			},
		)) as FullHttpResponse;

		const raw = isRecord(response) && 'body' in response ? response.body : response;
		const record: IDataObject = isRecord(raw) ? (raw as IDataObject) : {};
		const usage = isRecord(record.usage) ? record.usage : undefined;
		const headers = isRecord(response) && isRecord(response.headers) ? response.headers : {};

		return {
			answers: isRecord(record.answers) ? record.answers : {},
			usage:
				usage && typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number'
					? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }
					: undefined,
			model: typeof record.model === 'string' ? record.model : undefined,
			requestId: readHeader(headers, 'x-typesafe-request-id'),
			status:
				isRecord(response) && typeof response.statusCode === 'number'
					? response.statusCode
					: undefined,
			raw: record,
		};
	};
}
