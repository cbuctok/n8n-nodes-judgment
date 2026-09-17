import { TYPESAFE_API_BASE_URL } from '../nodes/TypeSafe/shared/types';

import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class TypeSafeApi implements ICredentialType {
	name = 'typeSafeApi';

	displayName = 'TypeSafe API';

	icon: Icon = { light: 'file:../icons/typesafe.svg', dark: 'file:../icons/typesafe.dark.svg' };

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
				'TypeSafe API key, created in the TypeSafe console under Settings → Keys. The node sends it as a bearer token.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			// TypeSafe's public API root. This is a sensible default, not a fixed deployment target:
			// the field exists precisely so a proxy or self-hosted endpoint can replace it.
			default: TYPESAFE_API_BASE_URL,
			description: 'The API root to call. Change this only when targeting a self-hosted or proxy endpoint.',
		},
		{
			displayName: 'Default Model',
			name: 'defaultModel',
			type: 'string',
			default: 'jev-latest',
			description: 'The System One model used when an evaluation does not override it',
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
			baseURL: `={{ $credentials?.baseUrl || "${TYPESAFE_API_BASE_URL}" }}`,
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
