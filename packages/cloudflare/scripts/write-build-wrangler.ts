/// <reference types="bun-types" />
import { COMPATIBILITY_DATE } from "../src/compatibility-date";

const args = Bun.argv.slice(2);
const get = (flag: string) => {
  const index = args.indexOf(flag);
  const value = args[index + 1];
  if (index === -1 || value === undefined || value === "") {
    throw new Error(`Missing required ${flag}`);
  }
  return value;
};

const out = get("--out");
const name = get("--name");
const main = get("--main");

const config = {
  compatibility_date: COMPATIBILITY_DATE,
  compatibility_flags: ["nodejs_compat"],
  main,
  name,
};

await Bun.write(out, `${JSON.stringify(config, null, 2)}\n`);
process.stdout.write(
  `Wrote ${out} with compatibility_date ${COMPATIBILITY_DATE}\n`
);
