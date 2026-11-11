import type { Construct, Extension, State } from "micromark-util-types";
import type { Processor } from "unified";

declare module "unified" {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Unified's processor data is an augmented interface.
  interface Data {
    micromarkExtensions?: Extension[] | undefined;
  }
}

const dollar = 36;
const zero = 48;
const nine = 57;

// Leave a currency opener as text if its first possible closing dollar cannot end inline math.
const currencyLookahead: Construct = {
  partial: true,
  tokenize(lookahead, literal, math) {
    const afterClosing: State = (code) => {
      lookahead.exit("data");
      return code === dollar || (code !== null && code >= zero && code <= nine)
        ? literal(code)
        : math(code);
    };

    const findClosing: State = (code) => {
      if (code === null || code < 0) {
        lookahead.exit("data");
        return literal(code);
      }
      if (code === dollar) {
        const { previous } = this;
        if (
          previous === null ||
          previous < 0 ||
          /\s/u.test(String.fromCodePoint(previous))
        ) {
          lookahead.exit("data");
          return literal(code);
        }
        lookahead.consume(code);
        return afterClosing;
      }
      lookahead.consume(code);
      return findClosing;
    };

    return (code) => {
      if (code === null || code < 0 || /\s/u.test(String.fromCodePoint(code))) {
        return literal(code);
      }
      if (code < zero || code > nine) {
        return math(code);
      }
      lookahead.enter("data");
      return findClosing(code);
    };
  },
};

const currency: Extension = {
  text: {
    [dollar]: {
      tokenize(effects, ok, nok) {
        return (code) => {
          effects.enter("data");
          effects.consume(code);
          effects.exit("data");
          return effects.check(currencyLookahead, ok, nok);
        };
      },
    },
  },
};

const remarkCurrency = function remarkCurrency(this: Processor) {
  // oxlint-disable-next-line oxc/no-this-in-exported-function -- Unified binds the processor when invoking a plugin.
  const data = this.data();
  data.micromarkExtensions ??= [];
  data.micromarkExtensions.push(currency);
};

export { remarkCurrency };
