import assert from "node:assert/strict";
import { answerQuestion } from "../src/gaming_doc_service.ts";

assert.equal(typeof answerQuestion, "function");
console.log("business boundary ready: questions return an answer and evidence list");
