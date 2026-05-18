export { Engine, type EngineDeps, type EvaluateOptions } from './engine.js';
export { attributePackage, enrichWithIoc } from './enricher.js';
export { matchesPath, type PathMatchOptions } from './path-match.js';
export { ruleApplies, type RuleMatchInput } from './rule-match.js';
export {
  loadRulesFromDirectory,
  parseRulesYaml,
  RuleValidationError,
} from './rule-loader.js';
