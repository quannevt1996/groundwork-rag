import { randomUUID } from "node:crypto";

/** Prefixed ids (`col_…`, `doc_…`) make logs and API payloads self-describing. */
export const newId = (prefix: "col" | "doc" | "chk" | "cnv" | "msg") => `${prefix}_${randomUUID().replaceAll("-", "")}`;
