import { describe, expect, test } from "vite-plus/test";

import {
  getUnresolvedSnippetFields,
  resolveSnippetVariables,
} from "../src/compose/snippet-variables";

describe(resolveSnippetVariables, () => {
  test("leaves ordinary braces, malformed markers, and literal markup unchanged", () => {
    const source =
      '<p title="name">{{name}} {{?}} {{?1name}} {{?first name}} {{@sender.name }}, <b>hello</b></p>';
    const result = resolveSnippetVariables(source, {});

    expect(result.text).toBe(source);
    expect(result.fields).toHaveLength(0);
  });

  test("fills exact contextual names and gathers adjacent unresolved keys once", () => {
    const result = resolveSnippetVariables(
      "{{@sender.name}}{{@sender.email}} {{@recipient.name}} {{?topic}}{{?topic}}{{?Topic}} {{@Sender.name}} {{@unknown.value}}",
      {
        "recipient.name": "  ",
        "sender.email": "ada@example.com",
        "sender.name": "Ada",
      }
    );

    expect(result.text).toContain("Adaada@example.com");
    expect(result.text).toContain("{{?recipient.name}}");
    expect(result.text).toContain("{{?Sender.name}}");
    expect(result.fields).toStrictEqual([
      "recipient.name",
      "topic",
      "Topic",
      "Sender.name",
      "unknown.value",
    ]);
  });

  test("uses shared field values exactly without overriding available context", () => {
    const result = resolveSnippetVariables(
      "{{@sender.name}} {{@recipient.email}} {{?topic}}/{{?topic}} {{?missing}}",
      { "sender.name": "Ada" },
      {
        missing: "\t\n ",
        "recipient.email": " grace@example.com ",
        "sender.name": "someone else",
        topic: "  the proposal\n",
      }
    );

    expect(result.text).toContain("Ada  grace@example.com ");
    expect(result.text).toContain("  the proposal\n/  the proposal\n");
    expect(result.fields).toStrictEqual(["missing"]);
  });

  test.each([
    { count: 1, replaced: false },
    { count: 2, replaced: true },
    { count: 3, replaced: false },
    { count: 4, replaced: true },
  ])("retains $count escaping backslashes", ({ count, replaced }) => {
    const prefix = "\\".repeat(count);
    const result = resolveSnippetVariables(
      `${prefix}{{?topic}}`,
      {},
      {
        topic: "proposal",
      }
    );

    expect(result.text).toBe(
      `${prefix}${replaced ? "proposal" : "{{?topic}}"}`
    );
    expect(result.fields).toHaveLength(0);
  });

  test("does not parse context or user replacements recursively", () => {
    const result = resolveSnippetVariables(
      "{{@sender.name}} {{?topic}}",
      { "sender.name": "{{?literal}}" },
      { literal: "changed", topic: "{{@recipient.name}}" }
    );

    expect(result.text).toBe("{{?literal}} {{@recipient.name}}");
    expect(result.fields).toHaveLength(0);
  });

  test("limits marker keys and does not inherit field values", () => {
    const validKey = `a${"b".repeat(63)}`;
    const invalidMarker = `{{?${validKey}c}}`;
    const result = resolveSnippetVariables(
      `{{?${validKey}}} ${invalidMarker} {{?constructor}} {{?toString}}`,
      {}
    );

    expect(result.text).toContain(invalidMarker);
    expect(result.fields).toStrictEqual([validKey, "constructor", "toString"]);
  });
});

describe(getUnresolvedSnippetFields, () => {
  test("checks both alternatives independently and preserves first-seen order", () => {
    const fields = getUnresolvedSnippetFields({
      bodyHtml: "<p>{{?htmlOnly}} {{?shared}} {{@recipient.email}}</p>",
      bodyText: "{{?textOnly}} {{?shared}}",
    });

    expect(fields).toStrictEqual([
      "textOnly",
      "shared",
      "htmlOnly",
      "recipient.email",
    ]);
    expect(
      getUnresolvedSnippetFields({ bodyHtml: "?joined}}", bodyText: "{{" })
    ).toHaveLength(0);
  });

  test("decodes entity braces and joins inline formatting and comments", () => {
    const fields = getUnresolvedSnippetFields({
      bodyHtml:
        "<p>&#123;&#x7b;?na<b>m</b><!-- comment -->e&#125;&rbrace; {{<i>@recipient.</i>email}}</p>",
    });

    expect(fields).toStrictEqual(["name", "recipient.email"]);
  });

  test("honors escapes across inline tags and decoded entities", () => {
    const fields = getUnresolvedSnippetFields({
      bodyHtml:
        "<p>&bsol;<b>{{?escaped}}</b> &bsol;<i>&bsol;</i>{{?active}}</p>",
      bodyText: "\\{{?escapedText}} \\\\{{?activeText}}",
    });

    expect(fields).toStrictEqual(["activeText", "active"]);
  });

  test("separates blocks and ignores attributes and non-visible elements", () => {
    const fields = getUnresolvedSnippetFields({
      bodyHtml:
        '<head><title>{{?head}}</title></head><p data-field="{{?attribute}}">{{?pa</p><p>ragraph}}</p><div>{{?li<br>ne}}</div><script>{{?script}}</script><style>{{?style}}</style><template>{{?template}}<template>{{?nested}}</template></template><!-- {{?comment}} --><p>{{?visible}}</p>',
    });

    expect(fields).toStrictEqual(["visible"]);
  });

  test("does not treat legacy or invalid markers as unresolved fields", () => {
    expect(
      getUnresolvedSnippetFields({
        bodyHtml: "<p>{{legacy}} {{?two words}} {{?x</p><p>}}</p>",
        bodyText: "{{legacy}} {{@}} {{?1name}} {{?no space }}",
      })
    ).toHaveLength(0);
  });

  test("handles deep and mismatched markup without hiding later fields", () => {
    const fields = getUnresolvedSnippetFields({
      bodyHtml: `<template>${"<template>".repeat(8000)}{{?hidden}}${"</template>".repeat(8001)}${"<div>".repeat(8000)}${"</unknown>".repeat(8000)}<p>{{?visible}}</p>`,
    });

    expect(fields).toStrictEqual(["visible"]);
  });

  test("does not let duplicate head tags hide visible body fields", () => {
    expect(
      getUnresolvedSnippetFields({
        bodyHtml: "<head><head>{{?first}}</head><p>{{?visible}}</p>",
      })
    ).toStrictEqual(["first", "visible"]);
  });

  test.each([
    "<head><p>{{?visible}}</p>",
    "<select><style></select><p>{{?visible}}</p>",
    "<select><title></select><p>{{?visible}}</p>",
    "<select><style>{{?visible}}</select>",
    "<select><title>{{?visible}}</select>",
    "<svg><title></svg><p>{{?visible}}</p>",
  ])("finds visible fields after HTML5 context changes in %s", (bodyHtml) => {
    expect(getUnresolvedSnippetFields({ bodyHtml })).toStrictEqual(["visible"]);
  });

  test("ignores actual title and template contents after HTML5 tree construction", () => {
    expect(
      getUnresolvedSnippetFields({
        bodyHtml:
          "<head><title>{{?headTitle}}</title></head><template>{{?hidden}}<p>{{?nested}}</p></template><svg><title>{{?svgTitle}}</title><text>{{?visible}}</text></svg>",
      })
    ).toStrictEqual(["visible"]);
  });

  test("finds implicitly closed head text and foreign CDATA while ignoring title text", () => {
    expect(
      getUnresolvedSnippetFields({
        bodyHtml:
          "<head><title>{{?title}}</title><p>{{?headBody}}</p><svg><text><![CDATA[{{?svgBody}}]]></text></svg>",
        bodyText: "safe alternative",
      })
    ).toStrictEqual(["headBody", "svgBody"]);
  });

  test("checks noscript content as script-disabled email content", () => {
    expect(
      getUnresolvedSnippetFields({
        bodyHtml:
          "<noscript>{{?<b>field</b>}} &lbrace;&lbrace;?encoded&rbrace;&rbrace;</noscript>",
        bodyText: "Ready",
      })
    ).toStrictEqual(["field", "encoded"]);
  });
});
