# Financial Planner

Read README.md for technical information.

## Naming

**Names say what the value is.** A reader should not have to look up the
declaration to know what a variable holds.

Single letters are for values with no domain meaning, in a scope you can take
in at a glance: `(a, b)` in a comparator, `(sum, item)` in a reduce, an index
`i`. Everything else gets a real name — especially anything that lives more
than a line or two.

```ts
// no
for (const t of transactions) {
  const c = effectiveCategory(t);
  spent.set(c, (spent.get(c) ?? 0) + -t.amount);
}

// yes
for (const transaction of transactions) {
  const category = effectiveCategory(transaction);
  spent.set(category, (spent.get(category) ?? 0) + -transaction.amount);
}
```

