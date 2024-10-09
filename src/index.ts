import { Probot } from "probot";
import { exec } from "child_process";
import util from "util"
import fs from "fs"
import { ICodeReview } from "./Models/CodeReview";
import { v4 } from "uuid";

const pexec = util.promisify(exec);

export default (app: Probot) => {
    app.on("pull_request.opened", async (context) => {
        // captura os dados do pull request
        const { owner, repo, pull_number } = context.pullRequest();

        const nome_branchs = await context.octokit.pulls.get({owner: owner, repo: repo, pull_number: pull_number}).then((response)=>{

            return {
                nome_branch_a: response.data.base.ref,
                nome_branch_b: response.data.head.ref
            }

        })

        // cria um delay para aguardar o merge finalizar
        let merge_commit = (await context.octokit.pulls.get({ owner, repo, pull_number })).data.merge_commit_sha;
        for (let i = 0; !merge_commit && i < 5; i++) {
            console.log("Waiting for merge commit...");
            await new Promise((resolve) => setTimeout(resolve, 2000));
            merge_commit = (await context.octokit.pulls.get({ owner, repo, pull_number })).data.merge_commit_sha;
        }

        // se não ocorre o merge ele lança uma exceção
        if (!merge_commit) throw new Error("No merge commit sha");
        console.log(merge_commit);

        // captura os dados da branch_a e branch_b
        const { parents } = (await context.octokit.repos.getCommit({ owner, repo, ref: merge_commit })).data;
        const left = parents[0].sha;
        const right = parents[1].sha;
        console.log(left, right);

        // clona o repositório
        if (fs.existsSync(repo)) fs.rmSync(repo, { recursive: true, force: true });
        await pexec(`git clone https://github.com/${owner}/${repo}`);
        process.chdir(repo);

        // captura os dados da branch base
        let { stdout: merge_base } = await pexec(`git merge-base ${left} ${right}`);
        merge_base = merge_base.trim();
        console.log(merge_base);

        // recria o merge localmente
        await pexec(`git checkout ${left}`);
        await pexec(`git merge ${right}`);
        merge_commit = (await pexec(`git rev-parse HEAD`)).stdout.trim();

        // executa o diff de dois pontos entre o base e o merge
        const { stdout: baseParaMerge } = await pexec(`git diff ${merge_base} ${merge_commit} -U10000`);

        // executa o diff de dois pontos entre o base e o left
        const { stdout: baseParaA } = await pexec(`git diff ${merge_base} ${left} -U10000`);

        // executa o diff de dois pontos entre o base e o right
        const { stdout: baseParaB } = await pexec(`git diff ${merge_base} ${right} -U10000`);

        const codeReview: ICodeReview = {
            uuid: v4(),
            repository: repo,
            owner: owner,
            pull_number: pull_number,
            base_a: baseParaA, // persiste a diferença entre o código do base e branch_a
            base_b: baseParaB, // persiste a diferença entre o código do base e branch_b
            base_merge: baseParaMerge, // persiste a diferença entre o código do base o merge do branch_a e branch_b
            branch_a: nome_branchs.nome_branch_a,
            branch_b: nome_branchs.nome_branch_b
        }

        //apagar pastas geradas quando-se clona o repositório
        process.chdir("..");
        fs.rm(repo, { recursive: true, force: true }, (err)=>{
            if (err) throw err;
        })

        await fetch("http://localhost:4000/codeReview", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ codeReview: codeReview })
        })
        .then((res) => console.log(res.text()))
        .catch((error) => console.log(error))

        // console.log(baseParaMerge);
        // console.log();
        // console.log(baseParaA);
        // console.log();
        // console.log(baseParaB);
    })
}