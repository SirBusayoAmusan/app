/* Re-export shim so engines can pull lexical helpers + the ranker without
   creating import cycles between the AI engines and the scoring layer. */
export { err, round1, clamp, tokenize, uid, jaccard, keywordSet, overlapCoefficient, hash, mapLimit } from '../lib/utils';
export { rankEvidence as rankEvidenceUnsafe, evidencePromptBlock } from './evidenceEngine';
