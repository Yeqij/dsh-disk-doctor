/**
 * Test-only stand-in for `@deepseek-ai/schemastery`.
 *
 * It records the shape the plugin declares (type, default, min, max, description)
 * without validating values, which is enough to load the entry module and assert
 * the declared configuration surface outside a DSH host.
 */
class Schema {
  constructor (spec) {
    this.spec = spec
  }

  default (value) { return new Schema({ ...this.spec, default: value }) }
  min (value) { return new Schema({ ...this.spec, min: value }) }
  max (value) { return new Schema({ ...this.spec, max: value }) }
  description (value) { return new Schema({ ...this.spec, description: value }) }
  volatile () { return new Schema({ ...this.spec, volatile: true }) }
}

const z = {
  string: () => new Schema({ type: 'string' }),
  number: () => new Schema({ type: 'number' }),
  natural: () => new Schema({ type: 'number', natural: true }),
  boolean: () => new Schema({ type: 'boolean' }),
  array: (inner) => new Schema({ type: 'array', inner }),
  object: (dict) => new Schema({ type: 'object', dict })
}

export default z
