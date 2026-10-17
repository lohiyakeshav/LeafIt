// One typed-ish wrapper per backend route, so pages never build URLs or reshape payloads themselves.
import { api } from './client.js';

export const isAreaId = (id) => /^a_[0-9a-f]{12}$/.test(id);

export const endpoints = {
  listBlocks: () => api.get('/blocks'),
  getBlock: (id) => api.get(isAreaId(id) ? `/areas/${id}` : `/blocks/${id}`),
  createArea: (bounds, name) => api.post('/areas', { bounds, name }),
  areaConditions: (id) => api.get(`/areas/${id}/conditions`),
  simulate: (blockId, placements, years, unitCost) => api.post('/simulate', { block_id: blockId, placements, years, unit_cost: unitCost ?? undefined }),
  agentPlan: (body) => api.post('/agent', body),
  createPlan: (body) => api.post('/plans', body),
  planBom: (id) => api.get(`/plans/${id}/bom`),
  planProposal: (id, currency = 'INR') => api.post(`/plans/${id}/proposal`, { currency }),
  assumptions: () => api.get('/assumptions'),
  vendors: (query) => api.get('/vendors', query),
  quote: (plan_id, vendor_id) => api.post('/quotes', { plan_id, vendor_id }),
};
