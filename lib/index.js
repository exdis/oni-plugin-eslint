const path = require('path');
const findUp = require('find-up');

let lastErrors = {};
let lastArgs = null;

const filetypes = ['.js', '.jsx'];

const activate = Oni => {
    const doLintForFile = async args => {
        if (!args.filePath) {
            return;
        }
        const ext = path.extname(args.filePath);
        const acceptedFiletype = filetypes.includes(ext);
        if (!acceptedFiletype) {
            return;
        }

        const currentWorkingDirectory = getCurrentWorkingDirectory(args.filePath);
        const filePath = await getLintConfig(currentWorkingDirectory);

        if (!filePath) {
            throw new Error('No eslint config found; not running eslint.');
        }

        const errors = await executeEsLint(
            filePath,
            [args.filePath],
            currentWorkingDirectory
        );

        const fileErrors = errors[args.filePath] || [];

        Oni.diagnostics.setErrors(args.filePath, 'eslint-js', fileErrors);

        if (!fileErrors || fileErrors.length === 0) {
            lastErrors[args.filePath] = null;
        }
    };

    const doLintForProject = async (args, autoFix) => {
        if (!args.filePath) {
            return;
        }

        lastArgs = args;

        const currentWorkingDirectory = getCurrentWorkingDirectory(args.filePath);
        const filePath = await getLintConfig(currentWorkingDirectory);
        if (!filePath) {
            throw new Error('No eslint config found; not running eslint.');
        }
        const processArgs = [args.filePath];

        const errors = await executeEsLint(
            filePath,
            processArgs,
            currentWorkingDirectory,
            autoFix
        );
        // Send all updated errors
        Object.keys(errors).forEach(f => {
            Oni.diagnostics.setErrors('eslint-js', f, errors[f], 'yellow');
        });

        // Send all errors that were cleared
        Object.keys(lastErrors).forEach(f => {
            if (lastErrors[f] && !errors[f]) {
                Oni.diagnostics.setErrors('eslint-js', f, [], 'yellow');
            }
        });

        lastErrors = errors;
    };

    Oni.editors.activeEditor.onBufferSaved.subscribe(buf => doLintForFile(buf));
    Oni.editors.activeEditor.onBufferEnter.subscribe(buf => doLintForFile(buf));
    Oni.commands.registerCommand('eslint.fix', () =>
        doLintForProject(lastArgs, true)
    );

    async function executeEsLint(configPath, args, workingDirectory, autoFix) {
        const nodeModulesPath = await getNodeModules(workingDirectory);
        const eslintPath = path.join(nodeModulesPath, '.bin', 'eslint');
        let processArgs = [];

        if (autoFix) {
            processArgs = [...processArgs, '--fix'];
        }

        processArgs = [
            ...processArgs,
            '--format',
            'json',
            '--config',
            configPath,
            ...args,
        ];

        return new Promise((resolve) => {
            Oni.process.execNodeScript(
                eslintPath,
                processArgs,
                { cwd: workingDirectory },
                (err, stdout) => {
                    const errorOutput = stdout.trim();

                    const lintErrors = JSON.parse(errorOutput);

                    const errorsWithFileName = lintErrors.reduce((prev, curr) => {
                        if (curr.messages.length) {
                            curr.messages.forEach(item => {
                                prev.push({
                                    type: null,
                                    file: path.normalize(curr.filePath),
                                    message: item.message,
                                    severity: item.severity === 2 ? 1 : 2,
                                    range: {
                                        start: {
                                            line: item.line - 1,
                                            character: item.column - 1,
                                        },
                                        end: {
                                            line: item.endLine ? item.endLine - 1 : item.line - 1,
                                            character: item.endColumn ? item.endColumn - 1 : item.column - 1,
                                        },
                                    },
                                });
                            });
                        }

                        return prev;
                    }, []);

                    const errors = errorsWithFileName.reduce((prev, curr) => {
                        prev[curr.file] = prev[curr.file] || [];

                        prev[curr.file].push({
                            message: curr.message,
                            range: curr.range,
                            severity: curr.severity,
                            type: curr.type,
                        });

                        return prev;
                    }, {});

                    resolve(errors);
                }
            );
        });
    }

    function getCurrentWorkingDirectory(args) {
        return path.dirname(args);
    }

    async function getNodeModules(dir) {
        return await findUp('node_modules', dir);
    }

    async function getLintConfig() {
        const configPatterns = ['.eslintrc'];
        try {
            const eslintConfig = await findUp(configPatterns);
            return eslintConfig;
        } catch (e) {
            return null;
        }
    }
};

module.exports = {
    activate,
};
