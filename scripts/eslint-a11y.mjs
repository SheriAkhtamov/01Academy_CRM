const attribute = (node, name) => node.attributes.find((prop) => (
  prop.type === 'JSXAttribute' && prop.name.name === name
));

const literalValue = (prop) => {
  const value = prop?.value;
  return value?.type === 'JSXExpressionContainer' ? value.expression.value : value?.value;
};

const hasNameAttribute = (node) => ['aria-label', 'aria-labelledby', 'title'].some((name) => {
  const prop = attribute(node, name);
  return Boolean(prop?.value) && literalValue(prop) !== '';
});

const hasScreenReaderText = (node) => node.children.some((child) => {
  if (child.type !== 'JSXElement') return false;
  const classes = literalValue(attribute(child.openingElement, 'className'));
  return (typeof classes === 'string' && classes.split(/\s+/).includes('sr-only')
    && child.children.some((content) => (
      (content.type === 'JSXText' && content.value.trim())
      || (content.type === 'JSXExpressionContainer' && content.expression.type !== 'JSXEmptyExpression')
    ))) || hasScreenReaderText(child);
});

const onlyStopsPropagation = (prop) => {
  const body = prop?.value?.expression?.body;
  const call = body?.type === 'BlockStatement' && body.body.length === 1
    ? body.body[0].expression : body;
  return call?.type === 'CallExpression'
    && call.callee.type === 'MemberExpression'
    && call.callee.property.name === 'stopPropagation';
};

export default {
  rules: {
    'icon-button-name': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { missingName: 'Icon-only Button must have an accessible name.' },
      },
      create(context) {
        return {
          JSXElement(node) {
            const opening = node.openingElement;
            if (opening.name.name !== 'Button' || literalValue(attribute(opening, 'size')) !== 'icon') return;
            if (opening.attributes.some((prop) => prop.type === 'JSXSpreadAttribute')) return;
            if (!hasNameAttribute(opening) && !hasScreenReaderText(node)) {
              context.report({ node: opening, messageId: 'missingName' });
            }
          },
        };
      },
    },
    'clickable-element-role': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { missingRole: 'Clickable div/span must have a role or tabIndex.' },
      },
      create(context) {
        return {
          JSXOpeningElement(node) {
            if (!['div', 'span'].includes(node.name.name)) return;
            if ([true, 'true'].includes(literalValue(attribute(node, 'aria-hidden')))) return;
            const onClick = attribute(node, 'onClick');
            if (!onClick || onlyStopsPropagation(onClick)) return;
            if (node.attributes.some((prop) => prop.type === 'JSXSpreadAttribute')) return;
            if (!attribute(node, 'role') && !attribute(node, 'tabIndex')) {
              context.report({ node, messageId: 'missingRole' });
            }
          },
        };
      },
    },
  },
};
