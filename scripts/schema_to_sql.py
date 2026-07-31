import re
import sys

with open("prisma/schema.prisma") as f:
    content = f.read()

lines = content.split("\n")
clean_lines = []
for l in lines:
    if l.strip().startswith("//"):
        continue
    clean_lines.append(l)
content_nc = "\n".join(clean_lines)

enum_pattern = re.compile(r'enum (\w+) \{(.*?)\n\}', re.S)
enums = {}
for m in enum_pattern.finditer(content_nc):
    name = m.group(1)
    values = [v.strip() for v in m.group(2).strip().split("\n") if v.strip()]
    enums[name] = values

model_pattern = re.compile(r'model (\w+) \{\n(.*?)\n\}', re.S)
models = {}
model_order = []
for m in model_pattern.finditer(content_nc):
    name = m.group(1)
    models[name] = m.group(2)
    model_order.append(name)

FIELD_LINE = re.compile(r'^\s*(\w+)\s+(\w+)(\?)?(\[\])?\s*(.*)$')

def parse_attrs(rest):
    attrs = []
    i = 0
    while i < len(rest):
        m = re.match(r'@(@?[\w.]+)(\(([^()]*(\([^()]*\))?[^()]*)\))?', rest[i:])
        if not m:
            i += 1
            continue
        attrs.append((m.group(1), m.group(3) or ""))
        i += m.end()
    return attrs

def sql_type(prisma_type, is_list, db_attr):
    if is_list:
        base = {"String": "TEXT", "Int": "INTEGER"}.get(prisma_type, "TEXT")
        return f"{base}[]"
    if db_attr:
        d = db_attr.lower()
        if d.startswith("uuid"):
            return "UUID"
        if d.startswith("char("):
            n = re.search(r"char\((\d+)\)", d).group(1)
            return f"CHAR({n})"
        if d.startswith("timestamptz"):
            return "TIMESTAMPTZ"
        if d.startswith("decimal("):
            nums = re.search(r"decimal\((\d+),\s*(\d+)\)", d)
            return f"NUMERIC({nums.group(1)},{nums.group(2)})"
    if prisma_type in enums:
        return f'"{prisma_type}"'
    return {
        "String": "TEXT",
        "Int": "INTEGER",
        "Float": "DOUBLE PRECISION",
        "Boolean": "BOOLEAN",
        "DateTime": "TIMESTAMPTZ",
        "Json": "JSONB",
        "Decimal": "NUMERIC",
    }.get(prisma_type, "TEXT")

table_defs = {}
model_to_table = {}

for model in model_order:
    body = models[model]
    m_map = re.search(r'@@map\("(\w+)"\)', body)
    table_name = m_map.group(1) if m_map else model.lower() + "s"
    model_to_table[model] = table_name

for model in model_order:
    body = models[model]
    columns = []
    fks = []
    composite_pk = None
    uniques = []
    indexes = []
    field_scalar_by_name = {}
    raw_lines = [l for l in body.split("\n") if l.strip()]

    for raw in raw_lines:
        stripped = raw.strip()
        if stripped.startswith("@@"):
            continue
        fm = FIELD_LINE.match(raw)
        if not fm:
            continue
        fname, ftype, optional, is_list, rest = fm.groups()
        attrs = parse_attrs(rest)
        attr_names = [a[0] for a in attrs]
        if ftype in models:
            continue
        col_name = fname
        for an, av in attrs:
            if an == "map":
                mm = re.search(r'"([^"]+)"', av)
                if mm:
                    col_name = mm.group(1)
        field_scalar_by_name[fname] = col_name

    for raw in raw_lines:
        stripped = raw.strip()
        if stripped.startswith("@@map"):
            continue
        if stripped.startswith("@@unique"):
            inner = re.search(r'\[([^\]]+)\]', stripped).group(1)
            names = [n.strip() for n in inner.split(",")]
            cols = [field_scalar_by_name.get(n, n) for n in names]
            uniques.append(cols)
            continue
        if stripped.startswith("@@index"):
            inner = re.search(r'\[([^\]]+)\]', stripped).group(1)
            names = [n.strip() for n in inner.split(",")]
            cols = [field_scalar_by_name.get(n, n) for n in names]
            indexes.append(cols)
            continue
        if stripped.startswith("@@id"):
            inner = re.search(r'\[([^\]]+)\]', stripped).group(1)
            names = [n.strip() for n in inner.split(",")]
            composite_pk = [field_scalar_by_name.get(n, n) for n in names]
            continue

        fm = FIELD_LINE.match(raw)
        if not fm:
            continue
        fname, ftype, optional, is_list, rest = fm.groups()
        attrs = parse_attrs(rest)
        attr_names = [a[0] for a in attrs]

        if ftype in models:
            if "relation" in attr_names:
                rel_arg = [av for an, av in attrs if an == "relation"][0]
                fields_m = re.search(r'fields:\s*\[([^\]]+)\]', rel_arg)
                refs_m = re.search(r'references:\s*\[([^\]]+)\]', rel_arg)
                ondelete_m = re.search(r'onDelete:\s*(\w+)', rel_arg)
                if fields_m and refs_m:
                    fk_field_names = [n.strip() for n in fields_m.group(1).split(",")]
                    ref_field_names = [n.strip() for n in refs_m.group(1).split(",")]
                    fk_cols = [field_scalar_by_name.get(n, n) for n in fk_field_names]
                    ref_table = model_to_table[ftype]
                    on_delete = ondelete_m.group(1) if ondelete_m else "Restrict"
                    on_delete_sql = {"Restrict": "RESTRICT", "Cascade": "CASCADE", "SetNull": "SET NULL"}.get(on_delete, "RESTRICT")
                    fks.append({
                        "cols": fk_cols,
                        "ref_table": ref_table,
                        "ref_cols": ref_field_names,
                        "ref_model": ftype,
                        "on_delete": on_delete_sql,
                    })
            continue

        col_name = field_scalar_by_name[fname]
        db_attr = None
        for an, av in attrs:
            if an.startswith("db."):
                # av is the *inner* content of the attribute's parens (see
                # parse_attrs: it stores m.group(3), not m.group(2)), e.g.
                # "18, 4" for "@db.Decimal(18, 4)". Re-wrap in parens here so
                # sql_type()'s `d.startswith("decimal(")` check and the
                # precision/scale regex actually match instead of silently
                # falling through to a bare, unbounded NUMERIC.
                db_attr = an[3:] + (f"({av})" if av else "")
        coltype = sql_type(ftype, bool(is_list), db_attr)
        is_pk = "id" in attr_names
        is_unique = "unique" in attr_names
        default_sql = None
        for an, av in attrs:
            if an == "default":
                if "uuid()" in av:
                    default_sql = "gen_random_uuid()"
                elif "now()" in av:
                    default_sql = "now()"
                elif av.strip() in ("true", "false"):
                    default_sql = av.strip()
                elif re.match(r'^-?\d+$', av.strip()):
                    default_sql = av.strip()
                elif av.strip() == "[]":
                    default_sql = "'{}'"
                else:
                    em = re.search(r'^(\w+)$', av.strip())
                    if em:
                        default_sql = f"'{em.group(1)}'"
        if "updatedAt" in attr_names:
            default_sql = default_sql or "now()"

        columns.append({
            "name": col_name, "type": coltype, "notnull": not bool(optional),
            "default": default_sql, "pk": is_pk, "unique": is_unique,
        })

    table_defs[model] = {
        "table": model_to_table[model], "columns": columns, "fks": fks,
        "uniques": uniques, "indexes": indexes, "composite_pk": composite_pk,
    }

for model, tdef in table_defs.items():
    for fk in tdef["fks"]:
        ref_model = fk["ref_model"]
        ref_body = models[ref_model]
        ref_field_scalar = {}
        for raw in [l for l in ref_body.split("\n") if l.strip()]:
            fm = FIELD_LINE.match(raw)
            if not fm:
                continue
            fname, ftype, optional, is_list, rest = fm.groups()
            if ftype in models:
                continue
            attrs = parse_attrs(rest)
            col_name = fname
            for an, av in attrs:
                if an == "map":
                    mm = re.search(r'"([^"]+)"', av)
                    if mm:
                        col_name = mm.group(1)
            ref_field_scalar[fname] = col_name
        fk["ref_cols_sql"] = [ref_field_scalar.get(n, n) for n in fk["ref_cols"]]

dep_graph = {m: set() for m in model_order}
for model, tdef in table_defs.items():
    for fk in tdef["fks"]:
        if fk["ref_model"] != model:
            dep_graph[model].add(fk["ref_model"])

sorted_models = []
visited = set()
temp = set()

def visit(n):
    if n in visited:
        return
    if n in temp:
        return
    temp.add(n)
    for dep in dep_graph.get(n, []):
        visit(dep)
    temp.discard(n)
    visited.add(n)
    sorted_models.append(n)

for m in model_order:
    visit(m)

out = []
out.append("-- Auto-generated initial migration (hand-authored transpiler, see docs/DECISION_LOG.md)")
out.append("-- Mirrors prisma/schema.prisma 1:1. Generated because `prisma migrate diff` could not run")
out.append("-- in this sandbox (binaries.prisma.sh is blocked). Superseded by a real")
out.append("-- `prisma migrate dev` history on first run with normal internet access.")
out.append("")

for enum_name, values in enums.items():
    vals = ", ".join(f"'{v}'" for v in values)
    out.append(f'CREATE TYPE "{enum_name}" AS ENUM ({vals});')
out.append("")

for model in sorted_models:
    tdef = table_defs[model]
    out.append(f'CREATE TABLE "{tdef["table"]}" (')
    col_lines = []
    for c in tdef["columns"]:
        line = f'  "{c["name"]}" {c["type"]}'
        if c["notnull"]:
            line += " NOT NULL"
        if c["default"] is not None:
            line += f' DEFAULT {c["default"]}'
        col_lines.append(line)
    if tdef["composite_pk"]:
        pk_cols = ", ".join(f'"{c}"' for c in tdef["composite_pk"])
        col_lines.append(f'  PRIMARY KEY ({pk_cols})')
    else:
        for c in tdef["columns"]:
            if c["pk"]:
                col_lines.append(f'  PRIMARY KEY ("{c["name"]}")')
    out.append(",\n".join(col_lines))
    out.append(");")
    out.append("")

for model in sorted_models:
    tdef = table_defs[model]
    for u in tdef["uniques"]:
        cols = ", ".join(f'"{c}"' for c in u)
        idx_name = f'{tdef["table"]}_{"_".join(u)}_key'[:63]
        out.append(f'CREATE UNIQUE INDEX "{idx_name}" ON "{tdef["table"]}" ({cols});')
    for c in tdef["columns"]:
        if c["unique"] and not tdef["composite_pk"]:
            idx_name = f'{tdef["table"]}_{c["name"]}_key'[:63]
            out.append(f'CREATE UNIQUE INDEX "{idx_name}" ON "{tdef["table"]}" ("{c["name"]}");')
    for ix in tdef["indexes"]:
        cols = ", ".join(f'"{c}"' for c in ix)
        idx_name = f'{tdef["table"]}_{"_".join(ix)}_idx'[:63]
        out.append(f'CREATE INDEX "{idx_name}" ON "{tdef["table"]}" ({cols});')
out.append("")

for model in sorted_models:
    tdef = table_defs[model]
    for fk in tdef["fks"]:
        cols = ", ".join(f'"{c}"' for c in fk["cols"])
        ref_cols = ", ".join(f'"{c}"' for c in fk["ref_cols_sql"])
        cname = f'{tdef["table"]}_{"_".join(fk["cols"])}_fkey'[:63]
        out.append(
            f'ALTER TABLE "{tdef["table"]}" ADD CONSTRAINT "{cname}" '
            f'FOREIGN KEY ({cols}) REFERENCES "{fk["ref_table"]}" ({ref_cols}) ON DELETE {fk["on_delete"]};'
        )

sql = "\n".join(out)
with open("prisma/migration_generated.sql", "w") as f:
    f.write(sql)

print(f"models: {len(model_order)}, enums: {len(enums)}")
print(f"tables emitted: {len(sorted_models)}")
print("wrote prisma/migration_generated.sql")
