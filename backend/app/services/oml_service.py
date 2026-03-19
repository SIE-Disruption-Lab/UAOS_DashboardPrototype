"""
OML service: parse uploaded .oml files, generate bundle.oml and catalog.xml
for a project instance directory.
"""
import re
import os
from pathlib import Path


# ---------------------------------------------------------------------------
# Namespace parsing
# ---------------------------------------------------------------------------

_NS_RE = re.compile(
    r'(?:description\s+(?:bundle\s+)?|vocabulary\s+)<([^#>]+)#?>',
    re.MULTILINE
)


def extract_namespace(content: str) -> str | None:
    """Return the namespace URI (without trailing #) from an OML file."""
    m = _NS_RE.search(content)
    return m.group(1).rstrip('/') if m else None


def get_project_slug_from_namespace(ns_uri: str) -> str:
    """
    http://uaontologies.com/DesertStorm/DesertStorm
    → 'DesertStorm'  (the project-level segment)
    """
    parts = [p for p in ns_uri.split('/') if p]
    # last two parts are typically <ProjectSlug>/<FileName>
    if len(parts) >= 2:
        return parts[-2]
    return parts[-1]


def infer_project_namespace(oml_files: list[tuple[str, str]]) -> tuple[str, str]:
    """
    Given [(filename, content), ...] return (namespace_base, project_slug).
    namespace_base: e.g. 'http://uaontologies.com/DesertStorm'
    project_slug:   e.g. 'DesertStorm'
    Skips bundle files; uses the first non-bundle description found.
    """
    for filename, content in oml_files:
        if 'bundle' in filename.lower():
            continue
        ns = extract_namespace(content)
        if ns:
            slug = get_project_slug_from_namespace(ns)
            base = '/'.join(ns.split('/')[:-1])  # drop the file-level segment
            return base, slug
    # fallback: derive from any file
    for _, content in oml_files:
        ns = extract_namespace(content)
        if ns:
            slug = get_project_slug_from_namespace(ns)
            base = '/'.join(ns.split('/')[:-1])
            return base, slug
    raise ValueError("Could not determine project namespace from uploaded OML files.")


# ---------------------------------------------------------------------------
# File generation
# ---------------------------------------------------------------------------

def generate_catalog_xml(namespace_base: str, project_slug: str) -> str:
    return f"""<?xml version="1.0"?>
<catalog xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog" prefer="public">
\t<rewriteURI uriStartString="{namespace_base}/" rewritePrefix="src/oml/uaontologies.com/{project_slug}/"/>
\t<rewriteURI uriStartString="http://" rewritePrefix="build/oml/"/>
</catalog>
"""


def generate_bundle_oml(namespace_base: str, project_slug: str,
                         description_namespaces: list[str]) -> str:
    includes = "\n".join(
        f"\tincludes <{ns}#>" for ns in description_namespaces
    )
    return (
        f"description bundle <{namespace_base}/bundle#> as ^bundle {{\n\n"
        f"{includes}\n\n"
        f"}}\n"
    )


def generate_fuseki_ttl(dataset_name: str) -> str:
    return f"""@prefix fuseki:  <http://jena.apache.org/fuseki#> .
@prefix rdf:     <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
@prefix tdb:     <http://jena.hpl.hp.com/2008/tdb#> .
@prefix ja:      <http://jena.hpl.hp.com/2005/11/Assembler#> .
@prefix :        <#> .

[] rdf:type fuseki:Server .

<#service> rdf:type fuseki:Service ;
    rdfs:label          "{dataset_name}" ;
    fuseki:name         "{dataset_name}" ;
    fuseki:serviceReadWriteGraphStore "data" ;
    fuseki:endpoint     [ fuseki:operation fuseki:query ; fuseki:name "sparql" ] ;
    fuseki:endpoint     [ fuseki:operation fuseki:shacl ; fuseki:name "shacl"  ] ;
    fuseki:dataset      <#dataset> .

<#dataset> rdf:type   tdb:DatasetTDB ;
  tdb:location "--mem--" ;
  ja:context [ ja:cxtName "arq:queryTimeout" ; ja:cxtValue "10000" ] ;
  tdb:unionDefaultGraph true .
"""


# ---------------------------------------------------------------------------
# Project instance setup
# ---------------------------------------------------------------------------

def setup_project_instance(
    project_dir: str,
    oml_files: list[tuple[str, bytes]],   # [(filename, raw_bytes), ...]
    template_dir: str,
    sparql_dir: str,
    local_maven_repo: str,
    dataset_name: str | None = None,      # overrides OML-derived slug for Fuseki
) -> dict:
    """
    Populate a project instance directory:
    1. Write uploaded OML files to src/oml/uaontologies.com/<slug>/
    2. Generate catalog.xml, bundle.oml, .fuseki.ttl
    3. Symlink/copy pre-defined SPARQL queries to src/sparql/

    Returns metadata dict: {namespace_base, project_slug, dataset_name, root_iri}
    """
    pd = Path(project_dir)

    # Decode and normalise line endings (OML parser rejects \r\n)
    decoded = [(fn, raw.decode('utf-8', errors='replace').replace('\r\n', '\n').replace('\r', '\n'))
               for fn, raw in oml_files]
    namespace_base, project_slug = infer_project_namespace(decoded)

    # Determine OML output directory
    oml_out = pd / 'src' / 'oml' / 'uaontologies.com' / project_slug
    oml_out.mkdir(parents=True, exist_ok=True)

    # Write OML files
    description_namespaces = []
    for filename, content in decoded:
        if 'bundle' in filename.lower():
            continue  # we'll regenerate this
        (oml_out / filename).write_text(content, encoding='utf-8')
        ns = extract_namespace(content)
        if ns:
            description_namespaces.append(ns)

    # Generate catalog.xml
    (pd / 'catalog.xml').write_text(
        generate_catalog_xml(namespace_base, project_slug), encoding='utf-8'
    )

    # Generate bundle.oml
    bundle_path = oml_out / 'bundle.oml'
    bundle_path.write_text(
        generate_bundle_oml(namespace_base, project_slug, description_namespaces),
        encoding='utf-8'
    )

    # Generate .fuseki.ttl — use caller-supplied dataset_name if provided,
    # otherwise fall back to the OML-derived project slug.
    if dataset_name is None:
        dataset_name = project_slug
    (pd / '.fuseki.ttl').write_text(
        generate_fuseki_ttl(dataset_name), encoding='utf-8'
    )

    # Copy SPARQL queries
    sparql_out = pd / 'src' / 'sparql'
    sparql_out.mkdir(parents=True, exist_ok=True)
    for f in Path(sparql_dir).glob('*.sparql'):
        import shutil
        shutil.copy2(f, sparql_out / f.name)

    # Create results directory
    (pd / 'build' / 'results').mkdir(parents=True, exist_ok=True)

    root_iri = f"{namespace_base}/bundle"

    return {
        "namespace_base": namespace_base,
        "project_slug":   project_slug,
        "dataset_name":   dataset_name,
        "root_iri":       root_iri,
    }
