---
metadata:
  name: api-query
  version: "1.0.0"
  author: PAW Team
  description: Make safe HTTPS API calls to external services
  category: api
  tags:
    - api
    - http
    - rest
    - query
    - fetch

capability:
  purpose: Execute safe, sandboxed HTTPS API calls
  actions:
    - api_call
    - fetch_data
    - query_api
    - get_price
    - get_data

input_schema:
  - name: url
    type: string
    required: true
    validation: "Must be HTTPS URL, no internal IPs"
    description: The API endpoint URL
  - name: method
    type: string
    required: false
    validation: "GET, POST, PUT, DELETE"
    default: "GET"
    description: HTTP method
  - name: headers
    type: object
    required: false
    description: HTTP headers
  - name: body
    type: object
    required: false
    description: Request body (for POST/PUT)

output_schema:
  structure:
    status: number
    body: object
  types:
    status: number
    body: object
  guarantees:
    - Only HTTPS endpoints are called
    - Internal/private IPs are blocked
    - Response is returned as-is

execution:
  execution_type: js
  entrypoint: api_call
  runtime_requirements: []
  dependencies: []

tools:
  apis: []
  contracts: []
  permissions_required:
    - external_api_call

safety:
  allowed_contracts: []
  forbidden_actions:
    - internal_network_access
  rate_limit_per_minute: 30

validation:
  preconditions:
    - URL must use HTTPS
    - URL must not resolve to internal/private IP
  postconditions:
    - Response received with HTTP status code

failure_modes:
  - risk: API timeout
    fallback: Retry up to 3 times with backoff
  - risk: Invalid URL
    fallback: Return clear error message
  - risk: API returns error
    fallback: Return status code and error body

permissions:
  allowed_actions:
    - external_api_call
  forbidden_actions:
    - internal_network_access

examples:
  - description: Get SOL price from CoinGecko
    input:
      url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
      method: "GET"
    expected_output:
      status: 200
      body:
        solana:
          usd: 150.00
---

# API Query Skill

Makes safe, sandboxed HTTPS API calls to external services.

## Safety
- Only HTTPS endpoints allowed
- Internal/private IPs are blocked
- Rate limited to 30 calls per minute

## Usage
Tell the agent: "Get the current SOL price" or "Fetch data from [API]"
