class Repo:
    def find(self, key):
        raise NotImplementedError


class Service:
    def __init__(self, repo):
        self.repo = repo

    def label(self, key):
        row = self.repo.find(key)
        if row is None:
            return "missing"
        return "found:" + str(row["name"]).upper()


def collect(items, sink):
    for item in items:
        if item > 0:
            sink(item)
    return len(items)
