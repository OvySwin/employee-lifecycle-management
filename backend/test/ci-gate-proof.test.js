import { it, expect } from 'vitest';
// Intentional failure on an isolated proof branch; never merge this test.
it('demonstrates the CI release gate rejects a failed test',()=>{ expect(true).toBe(false); });
