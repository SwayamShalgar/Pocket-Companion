const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const file = path.join(__dirname, 'App.js');
const source = fs.readFileSync(file, 'utf8');

const ast = parser.parse(source, {
  sourceType: 'module',
  plugins: ['jsx']
});

if (
  ast.program.body.some(
    node =>
      t.isImportDeclaration(node) &&
      node.source.value === './ui/Experience'
  )
) {
  console.log(
    'The UI upgrade is already applied. No files changed.'
  );
  process.exit(0);
}

if (
  !fs.existsSync(
    path.join(__dirname, 'ui', 'Experience.js')
  )
) {
  throw new Error('Create ui/Experience.js first.');
}

const helpers = new Set([
  'Icon',
  'Button',
  'Round',
  'Input',
  'Section',
  'Empty',
  'Bar',
  'Sheet'
]);

const removed = new Set();

const changed = {
  header: 0,
  hero: 0,
  nav: 0,
  remote: 0,
  screen: 0,
  provider: 0,
  theme: 0
};

const jsx = code =>
  parser.parseExpression(code, {
    plugins: ['jsx']
  });

function styleIs(node, name) {
  const style = node.openingElement.attributes.find(
    attribute =>
      t.isJSXAttribute(attribute) &&
      attribute.name.name === 'style'
  );

  const expression = style?.value?.expression;

  return (
    t.isMemberExpression(expression) &&
    t.isIdentifier(expression.object, { name: 's' }) &&
    t.isIdentifier(expression.property, { name })
  );
}

function attribute(node, name) {
  return node.openingElement.attributes.find(
    item =>
      t.isJSXAttribute(item) &&
      item.name.name === name
  )?.value;
}

traverse(ast, {
  FunctionDeclaration(p) {
    if (helpers.has(p.node.id?.name)) {
      removed.add(p.node.id.name);
      p.remove();
      return;
    }

    if (p.node.id?.name === 'App') {
      const statement = p.node.body.body.find(
        node => t.isReturnStatement(node)
      );

      if (
        !statement ||
        !t.isJSXElement(statement.argument)
      ) {
        throw new Error(
          'App wrapper differs from the expected version. No changes saved.'
        );
      }

      statement.argument = t.jsxElement(
        t.jsxOpeningElement(
          t.jsxIdentifier('MotionProvider'),
          []
        ),
        t.jsxClosingElement(
          t.jsxIdentifier('MotionProvider')
        ),
        [statement.argument]
      );

      changed.provider++;
    }
  },

  VariableDeclarator(p) {
    if (
      t.isIdentifier(p.node.id, { name: 'C' }) &&
      t.isObjectExpression(p.node.init)
    ) {
      p.node.init = t.identifier('palette');
      changed.theme++;
    }
  },

  JSXExpressionContainer(p) {
    const expression = p.node.expression;

    if (
      t.isConditionalExpression(expression) &&
      t.isBinaryExpression(
        expression.test,
        { operator: '===' }
      ) &&
      t.isIdentifier(
        expression.test.left,
        { name: 'tab' }
      ) &&
      t.isStringLiteral(
        expression.test.right,
        { value: 'Assistant' }
      )
    ) {
      p.replaceWith(
        t.jsxElement(
          t.jsxOpeningElement(
            t.jsxIdentifier('ScreenTransition'),
            [
              t.jsxAttribute(
                t.jsxIdentifier('scene'),
                t.jsxExpressionContainer(
                  t.identifier('tab')
                )
              )
            ]
          ),
          t.jsxClosingElement(
            t.jsxIdentifier('ScreenTransition')
          ),
          [t.jsxExpressionContainer(expression)]
        )
      );

      changed.screen++;
      p.skip();
    }
  },

  JSXElement(p) {
    const node = p.node;

    if (
      !t.isJSXIdentifier(
        node.openingElement.name,
        { name: 'View' }
      )
    ) {
      return;
    }

    if (styleIs(node, 'header')) {
      p.replaceWith(
        jsx(`
          <ConnectionHeader
            online={online}
            connected={!!connection}
            computer={status?.computer}
            updated={updated}
            onPress={() => setSettings(true)}
            disabled={!!busy}
          />
        `)
      );

      changed.header++;
      p.skip();
    } else if (styleIs(node, 'hero')) {
      p.replaceWith(
        jsx(`
          <HeroCard
            battery={battery}
            online={online}
            computer={status?.computer}
            updated={updated}
          />
        `)
      );

      changed.hero++;
      p.skip();
    } else if (styleIs(node, 'nav')) {
      p.replaceWith(
        jsx(`
          <TabBar
            tabs={tabs}
            active={tab}
            onChange={switchTab}
          />
        `)
      );

      changed.nav++;
      p.skip();
    }
  }
});

// Visit descendants skipped when adding the screen wrapper.
traverse(ast, {
  JSXElement(p) {
    const node = p.node;

    if (
      t.isJSXIdentifier(
        node.openingElement.name,
        { name: 'View' }
      ) &&
      styleIs(node, 'hero')
    ) {
      p.replaceWith(
        jsx(`
          <HeroCard
            battery={battery}
            online={online}
            computer={status?.computer}
            updated={updated}
          />
        `)
      );

      changed.hero++;
      p.skip();
    }

    if (
      t.isJSXIdentifier(
        node.openingElement.name,
        { name: 'Button' }
      ) &&
      attribute(node, 'title')?.value ===
        'Open remote controls'
    ) {
      p.replaceWith(
        jsx(`
          <QuickActions
            disabled={!online || !!busy}
            onRemote={() => setRemoteVisible(true)}
            onFiles={() => switchTab("Files")}
            onApps={() => switchTab("Apps")}
          />
        `)
      );

      changed.remote++;
      p.skip();
    }

    const contentStyle = {
      openingElement: {
        attributes: node.openingElement.attributes.map(
          item =>
            t.isJSXAttribute(item) &&
            item.name.name === 'contentContainerStyle'
              ? t.jsxAttribute(
                t.jsxIdentifier('style'),
                item.value
              )
              : item
        )
      }
    };

    if (
      t.isJSXIdentifier(
        node.openingElement.name,
        { name: 'ScrollView' }
      ) &&
      styleIs(contentStyle, 'content') &&
      !attribute(node, 'key')
    ) {
      node.openingElement.attributes.push(
        t.jsxAttribute(
          t.jsxIdentifier('key'),
          t.jsxExpressionContainer(
            t.identifier('tab')
          )
        )
      );
    }
  },

  JSXText(p) {
    const replacements = {
      'A little more space.': 'Your files',
      'Ready when you are.': 'Your applications',
      'Make room for focus.': 'Your routines',
      'A little help.': 'Your assistant',
      'Your desk. Anywhere.': 'Your laptop, within reach.'
    };

    const value = p.node.value.trim();

    if (replacements[value]) {
      p.node.value = p.node.value.replace(
        value,
        replacements[value]
      );
    }
  }
});

for (const name of helpers) {
  if (!removed.has(name)) {
    throw new Error(
      `Could not find helper ${name}. No files changed. ` +
      'This installer expects the redesigned App.js from this conversation.'
    );
  }
}

for (const [name, count] of Object.entries(changed)) {
  if (count !== 1) {
    throw new Error(
      `Expected one ${name} section, found ${count}. ` +
      'No files changed. Send this message and your App.js for an adjusted patch.'
    );
  }
}

const names = [
  ...helpers,
  'palette',
  'MotionProvider',
  'ScreenTransition',
  'ConnectionHeader',
  'HeroCard',
  'QuickActions',
  'TabBar'
];

ast.program.body.unshift(
  t.importDeclaration(
    names.map(name =>
      t.importSpecifier(
        t.identifier(name),
        t.identifier(name)
      )
    ),
    t.stringLiteral('./ui/Experience')
  )
);

const output =
  generate(ast, { comments: true }, source).code + '\n';

parser.parse(output, {
  sourceType: 'module',
  plugins: ['jsx']
});

const remoteFile = path.join(
  __dirname,
  'RemoteControls.js'
);

let remoteSource;
let remoteOutput;

if (fs.existsSync(remoteFile)) {
  remoteSource = fs.readFileSync(remoteFile, 'utf8');

  const remoteAst = parser.parse(remoteSource, {
    sourceType: 'module',
    plugins: ['jsx']
  });

  const colors = {
    '#101310': '#0b1020',
    '#1b201b': '#131d31',
    '#252c24': '#1e2a43',
    '#f1f4eb': '#f4f7ff',
    '#a4ae9e': '#a9b8d2',
    '#d0f58a': '#87e6cd',
    '#243416': '#092e2a',
    '#46553a': '#39635f'
  };

  let found = false;

  traverse(remoteAst, {
    FunctionDeclaration(p) {
      if (p.node.id?.name === 'RemoteControls') {
        p.node.body.body.unshift(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier('reduceMotion'),
              t.callExpression(
                t.identifier('useReducedMotion'),
                []
              )
            )
          ])
        );

        found = true;
      }
    },

    StringLiteral(p) {
      if (colors[p.node.value]) {
        p.node.value = colors[p.node.value];
      }
    },

    JSXAttribute(p) {
      if (
        p.node.name.name === 'animationType' &&
        t.isStringLiteral(
          p.node.value,
          { value: 'slide' }
        )
      ) {
        p.node.value = t.jsxExpressionContainer(
          t.conditionalExpression(
            t.identifier('reduceMotion'),
            t.stringLiteral('none'),
            t.stringLiteral('slide')
          )
        );
      }
    }
  });

  if (!found) {
    throw new Error(
      'RemoteControls.js differs from the expected version. No files changed.'
    );
  }

  remoteAst.program.body.unshift(
    t.importDeclaration(
      [
        t.importSpecifier(
          t.identifier('useReducedMotion'),
          t.identifier('useReducedMotion')
        )
      ],
      t.stringLiteral('./ui/Experience')
    )
  );

  remoteOutput =
    generate(
      remoteAst,
      { comments: true },
      remoteSource
    ).code + '\n';

  parser.parse(remoteOutput, {
    sourceType: 'module',
    plugins: ['jsx']
  });
}

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-');

const backup = path.join(
  __dirname,
  'App.before-ui-' + stamp + '.js'
);

fs.writeFileSync(backup, source, { flag: 'wx' });

if (remoteOutput) {
  fs.writeFileSync(
    path.join(
      __dirname,
      'RemoteControls.before-ui-' + stamp + '.js'
    ),
    remoteSource,
    { flag: 'wx' }
  );

  fs.writeFileSync(remoteFile, remoteOutput);
}

fs.writeFileSync(file, output);

console.log(
  'UI upgraded. Original App.js saved to ' +
  path.basename(backup)
);

console.log(
  'Windows files, connection credentials, remote input, and downloads were not changed.'
);