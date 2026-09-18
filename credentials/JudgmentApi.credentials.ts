import { DEFAULT_MODEL } from '../nodes/Judgment/shared/models';
import { DEFAULT_API_BASE_URL } from '../nodes/Judgment/shared/types';

import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class JudgmentApi implements ICredentialType {
	name = 'judgmentApi';

	displayName = 'Judgment API';

	icon: Icon = { light: 'file:../icons/judgment.svg', dark: 'file:../icons/judgment.dark.svg' };

	documentationUrl = 'https://docs.typesafe.ai/api';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'API key for the judgement provider. The node sends it as a bearer token.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			// The provider's public API root. This is a sensible default, not a fixed deployment
			// target: the field exists precisely so a proxy or self-hosted endpoint can replace it.
			default: DEFAULT_API_BASE_URL,
			description:
				'The API root to call. Change this when targeting a self-hosted or proxy endpoint.',
		},
		{
			displayName: 'Default Model',
			name: 'defaultModel',
			type: 'string',
			default: DEFAULT_MODEL,
			description: 'The model used when an evaluation does not override it',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials?.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: `={{ $credentials?.baseUrl || "${DEFAULT_API_BASE_URL}" }}`,
			url: '/v1/models',
			method: 'GET',
			// The header has to be repeated here. n8n builds the test request from this object
			// alone and does not run the `authenticate` block, so relying on `authenticate` would
			// send an unauthenticated request and the test would fail with 403.
			headers: {
				Authorization: '=Bearer {{$credentials?.apiKey}}',
			},
		},
	};
}
