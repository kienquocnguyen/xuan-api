import { ContractValidationPipe } from './contract-validation.pipe.js';

describe('ContractValidationPipe.stripProtoKeys', () => {
  const strip = (value: unknown) => {
    new ContractValidationPipe().stripProtoKeys(value);
    return value;
  };

  it('removes prototype-pollution keys at every level, in objects and arrays', () => {
    const value = JSON.parse(
      '{"__proto__":{"admin":true},"a":{"constructor":{"x":1},"prototype":1,"b":[{"__proto__":{}, "keep":2}]}}',
    );
    expect(strip(value)).toEqual({ a: { b: [{ keep: 2 }] } });
    expect(Object.hasOwn(value, '__proto__')).toBe(false);
    expect(Object.hasOwn(value.a.b[0], '__proto__')).toBe(false);
  });

  it('keeps built-in values untouched', () => {
    const date = new Date(0);
    expect(strip({ at: date })).toEqual({ at: date });
  });

  it('handles 100 000 levels of nesting without overflowing the stack', () => {
    let deep: object = {};
    for (let i = 0; i < 100_000; i++) deep = { content: [deep] };
    expect(() => strip(deep)).not.toThrow();
  });
});
