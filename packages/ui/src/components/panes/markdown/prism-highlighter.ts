import { PrismLight } from "react-syntax-highlighter";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import scss from "react-syntax-highlighter/dist/esm/languages/prism/scss";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import http from "react-syntax-highlighter/dist/esm/languages/prism/http";
import regex from "react-syntax-highlighter/dist/esm/languages/prism/regex";

/**
 * The highlighter used for fenced code blocks, with only the grammars we
 * register. The full Prism build ships ~400 grammars and was most of the
 * preview's lazy chunk; a fence in a language that is not registered here
 * renders as plain code.
 *
 * Each grammar registers its own aliases (`sh`/`shell` → bash, `ts` →
 * typescript, `html`/`xml` → markup, `yml` → yaml, `py` → python, ...), so
 * fences can keep using the short names.
 */
PrismLight.registerLanguage("markup", markup);
PrismLight.registerLanguage("css", css);
PrismLight.registerLanguage("scss", scss);
PrismLight.registerLanguage("javascript", javascript);
PrismLight.registerLanguage("jsx", jsx);
PrismLight.registerLanguage("typescript", typescript);
PrismLight.registerLanguage("tsx", tsx);
PrismLight.registerLanguage("json", json);
PrismLight.registerLanguage("bash", bash);
PrismLight.registerLanguage("yaml", yaml);
PrismLight.registerLanguage("toml", toml);
PrismLight.registerLanguage("ini", ini);
PrismLight.registerLanguage("markdown", markdown);
PrismLight.registerLanguage("python", python);
PrismLight.registerLanguage("go", go);
PrismLight.registerLanguage("rust", rust);
PrismLight.registerLanguage("java", java);
PrismLight.registerLanguage("c", c);
PrismLight.registerLanguage("cpp", cpp);
PrismLight.registerLanguage("csharp", csharp);
PrismLight.registerLanguage("swift", swift);
PrismLight.registerLanguage("kotlin", kotlin);
PrismLight.registerLanguage("ruby", ruby);
PrismLight.registerLanguage("php", php);
PrismLight.registerLanguage("sql", sql);
PrismLight.registerLanguage("graphql", graphql);
PrismLight.registerLanguage("diff", diff);
PrismLight.registerLanguage("docker", docker);
PrismLight.registerLanguage("http", http);
PrismLight.registerLanguage("regex", regex);

export { PrismLight as SyntaxHighlighter };
