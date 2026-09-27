"""Tasks 5–10, 13–14: actual sentence embeddings, UMAP, clustering and neighbors.
First run --model /local/all-MiniLM-L6-v2; inspect lab8_cluster_evidence.json,
then create topic_labels.json and run again with --reuse to label/export.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import random
import re

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import normalize

SEED=401
MODEL_REVISION='1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
UMAP_SETTINGS=dict(n_components=2,n_neighbors=15,min_dist=0.15,metric='cosine',random_state=SEED,n_jobs=1)

def save_json(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n')

def formal_section_count(df):
    return int(df[['chapter','section']].drop_duplicates().shape[0])

def different_formal_section_indices(df,row):
    return np.flatnonzero(
        (df.chapter.to_numpy()!=row.chapter) |
        (df.section.to_numpy()!=row.section)
    )

def compute_embeddings(df,model_path):
    import torch
    from sentence_transformers import SentenceTransformer
    torch.manual_seed(SEED);torch.set_num_threads(4)
    local=Path(model_path).exists()
    model=SentenceTransformer(model_path,device='cpu',local_files_only=local,
        **({} if local else {'revision':MODEL_REVISION}))
    # Keep the model's taught 256-token context. Long passages are encoded in
    # complete-sentence chunks, then their token-weighted mean is normalized.
    # This preserves one passage/point without silently truncating the source.
    limit=model.max_seq_length-2
    texts=[];owners=[];weights=[];long_passages=0
    for i,text in enumerate(df.text_clean):
        ids=model.tokenizer.encode(text,add_special_tokens=False)
        if len(ids)<=limit:
            chunks=[text]
        else:
            long_passages+=1;chunks=[];current=''
            for sentence in re.split(r'(?<=[.!?])\s+',text):
                proposal=(current+' '+sentence).strip()
                if len(model.tokenizer.encode(proposal,add_special_tokens=False))<=limit:
                    current=proposal
                else:
                    if current:chunks.append(current)
                    tokens=model.tokenizer.encode(sentence,add_special_tokens=False)
                    while len(tokens)>limit:
                        chunks.append(model.tokenizer.decode(tokens[:limit]));tokens=tokens[limit:]
                    current=model.tokenizer.decode(tokens)
            if current:chunks.append(current)
        for chunk in chunks:
            length=len(model.tokenizer.encode(chunk,add_special_tokens=False))
            if length>limit:raise ValueError('Chunk exceeds the model context')
            texts.append(chunk);owners.append(i);weights.append(length)
    encoded=model.encode(texts,normalize_embeddings=True,batch_size=32,show_progress_bar=True)
    embeddings=np.zeros((len(df),encoded.shape[1]),dtype=np.float32)
    for v,i,w in zip(encoded,owners,weights):embeddings[i]+=v*w
    embeddings=normalize(embeddings)
    return embeddings,dict(max_seq_length=model.max_seq_length,long_passages_chunked=long_passages,
        encoded_chunks=len(texts),long_passage_method='Sentence-aligned chunks <=254 tokens; token-weighted mean of normalized chunk vectors, then L2 normalization.')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--data',type=Path,default=Path(__file__).resolve().parents[1]/'data')
    parser.add_argument('--model',default='sentence-transformers/all-MiniLM-L6-v2')
    parser.add_argument('--reuse',action='store_true')
    args=parser.parse_args();out=args.data
    random.seed(SEED);np.random.seed(SEED)
    source=out/'bulletin_passages.csv';df=pd.read_csv(source,keep_default_na=False)
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    cache=out/'lab8_model_cache.npz';meta_path=out/'lab8_model_report.json'
    if args.reuse:
        meta=json.loads(meta_path.read_text())
        if digest!=meta['corpus_sha256']:raise ValueError('Cached model does not match corpus')
        arrays=np.load(cache);embeddings=arrays['embeddings'];coords=arrays['coords'];clusters=arrays['clusters']
    else:
        import umap
        embeddings,chunk_meta=compute_embeddings(df,args.model)
        kmeans=KMeans(n_clusters=8,random_state=SEED,n_init='auto')
        clusters=kmeans.fit_predict(embeddings)
        coords=umap.UMAP(**UMAP_SETTINGS).fit_transform(embeddings)
        np.savez_compressed(cache,embeddings=embeddings,coords=coords,clusters=clusters)
        provenance=Path(args.model)/'download_provenance.json'
        meta=dict(model='sentence-transformers/all-MiniLM-L6-v2',dimensions=int(embeddings.shape[1]),
            normalized=True,device='cpu',random_seed=SEED,umap=UMAP_SETTINGS,
            clustering=dict(method='KMeans on original normalized embeddings',n_clusters=8,random_state=SEED,n_init='auto'),
            embedding_chunks=chunk_meta,corpus_sha256=digest,
            model_provenance=json.loads(provenance.read_text()) if provenance.exists() else {},
            versions={p:importlib.metadata.version(p) for p in ['numpy','pandas','scikit-learn','sentence-transformers','torch','transformers','umap-learn']})
        save_json(meta_path,meta)
    assert embeddings.shape==(len(df),384)
    assert np.isfinite(embeddings).all() and np.isfinite(coords).all()
    assert np.allclose(np.linalg.norm(embeddings,axis=1),1,atol=1e-5)
    df['cluster']=clusters;df['x']=coords[:,0];df['y']=coords[:,1]
    tfidf=TfidfVectorizer(stop_words='english',min_df=3,max_df=.8,ngram_range=(1,2),token_pattern=r'(?u)\b[a-zA-Z][a-zA-Z-]{2,}\b')
    terms=tfidf.fit_transform(df.text_clean);names=tfidf.get_feature_names_out()
    evidence=[]
    for c in range(8):
        indices=np.flatnonzero(clusters==c)
        mean_terms=np.asarray(terms[indices].mean(axis=0)).ravel()
        centroid=embeddings[indices].mean(axis=0,keepdims=True)
        rank=cosine_similarity(embeddings[indices],centroid).ravel()
        representative=indices[np.argsort(-rank,kind='stable')[:8]]
        evidence.append(dict(cluster=c,count=len(indices),terms=names[np.argsort(-mean_terms)[:12]].tolist(),
            representatives=df.iloc[representative][['passage_id','chapter','section','subsection','page','text']].to_dict('records')))
    save_json(out/'lab8_cluster_evidence.json',evidence)
    global_mean=np.asarray(terms.mean(axis=0)).ravel()
    pd.DataFrame([dict(term=names[i],mean_tfidf=float(global_mean[i])) for i in np.argsort(-global_mean)[:20]]).to_csv(out/'lab8_top_terms.csv',index=False)
    labels_path=Path(__file__).with_name('topic_labels.json')
    if not labels_path.exists():
        print('Inspect lab8_cluster_evidence.json; provide topic_labels.json and run --reuse.',flush=True);return
    labels=json.loads(labels_path.read_text())
    df['cluster_name']=[labels[str(int(c))]['name'] for c in clusters]
    df.to_csv(out/'lab8_embedding_map.csv',index=False)
    matrix=df.groupby(['chapter','section','cluster','cluster_name'],sort=False).size().reset_index(name='count')
    matrix.to_csv(out/'lab8_topic_section_matrix.csv',index=False)
    similarity=cosine_similarity(embeddings);np.fill_diagonal(similarity,-np.inf)
    neighbors={}
    cross_pairs=[]
    for i,row in df.iterrows():
        ranked=np.argsort(-similarity[i],kind='stable')[:5]
        neighbors[row.passage_id]=[dict(passage_id=df.iloc[j].passage_id,score=round(float(similarity[i,j]),7)) for j in ranked]
        different=different_formal_section_indices(df,row)
        j=different[np.argmax(similarity[i,different])]
        if i<j:cross_pairs.append(dict(a=row.passage_id,b=df.iloc[j].passage_id,score=float(similarity[i,j])))
    save_json(out/'lab8_neighbors.json',neighbors)
    topics=[dict(cluster=e['cluster'],name=labels[str(e['cluster'])]['name'],count=e['count'],terms=labels[str(e['cluster'])]['display_terms'],rationale=labels[str(e['cluster'])]['rationale'],
        representative_ids=[r['passage_id'] for r in e['representatives'][:3]],
        section_count=formal_section_count(df.loc[df.cluster.eq(e['cluster'])])) for e in evidence]
    sections=[]
    for (chapter,section),group in df.groupby(['chapter','section'],sort=False):
        counts=group.cluster.value_counts();p=counts/len(group)
        sections.append(dict(chapter=chapter,section=section,count=len(group),mean_words=float(group.word_count.mean()),
            topics=len(counts),entropy=float(-(p*np.log2(p)).sum()),counts={str(int(c)):int(n) for c,n in counts.items()}))
    queries={}
    for q in ['credit','graduation','registration','academic integrity']:
        group=df[df.text.str.contains(q,case=False,regex=False)]
        queries[q]=dict(count=len(group),topics={labels[str(int(c))]['name']:int(n) for c,n in group.cluster.value_counts().items()})
    summary=dict(topics=topics,sections=sections,queries=queries,
        cross_section_pairs=sorted(cross_pairs,key=lambda x:-x['score'])[:30])
    save_json(out/'lab8_analysis_summary.json',summary)
    print('Exported',len(df),'passages,',len(neighbors),'neighbor lists;',len(matrix),'nonzero matrix cells',flush=True)

if __name__=='__main__':main()
