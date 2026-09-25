from langchain_chess_server.graph import make_graph


def test_placeholder_graph_loads_and_runs():
    graph = make_graph({}, None)
    assert graph.name == "chess"
    assert graph.invoke({"messages": []}) == {"messages": []}
